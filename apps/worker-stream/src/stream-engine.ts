import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
// @ts-ignore
import ffmpegPath from 'ffmpeg-static';
import youtubedl from 'youtube-dl-exec';
import { prisma } from './services/db.js';

const ffmpegBinary = ffmpegPath || 'ffmpeg';

export interface StreamStats {
  isActive: boolean;
  projectId: string | null;
  currentVideo: {
    id: string;
    name: string;
    duration: number;
  } | null;
  nextVideo: {
    id: string;
    name: string;
  } | null;
  bitrate: number; // in kbps
  fps: number;
  elapsed: number; // in seconds
  duration: number;
  isFallback: boolean;
}

class StreamEngine {
  private ffmpegProcess: ChildProcess | null = null;
  private isRunning: boolean = false;
  private isSkipping: boolean = false;
  private dbCheckInterval: NodeJS.Timeout | null = null;

  // Track settings / playlist active state to detect updates
  private currentPlaylistId: string | null = null;
  private currentPlaylistVideoIds: string[] = [];
  private currentPreset: string | null = null;
  private currentRtmpUrl: string | null = null;
  private currentStreamKey: string | null = null;
  
  // In-memory stats
  private stats: StreamStats = {
    isActive: false,
    projectId: null,
    currentVideo: null,
    nextVideo: null,
    bitrate: 0,
    fps: 0,
    elapsed: 0,
    duration: 0,
    isFallback: false
  };

  private storageDir = process.env.STORAGE_DIR 
    ? path.resolve(process.env.STORAGE_DIR) 
    : path.join(process.cwd(), '..', '..', 'storage');
  
  constructor() {
    this.ensureFallbackVideo().catch(err => {
      console.error('Error creating fallback video on startup:', err);
    });
  }

  // Generate fallback video if it doesn't exist
  private async ensureFallbackVideo(): Promise<string> {
    const fallbackDir = path.join(this.storageDir, 'videos', 'fallback');
    fs.mkdirSync(fallbackDir, { recursive: true });
    const fallbackPath = path.join(fallbackDir, 'fallback.mp4');

    if (!fs.existsSync(fallbackPath)) {
      console.log('Generating silent black fallback video...');
      await this.logSystem('Generating silent black fallback video...', 'INFO');
      
      return new Promise<string>((resolve, reject) => {
        const ffmpeg = spawn(ffmpegBinary, [
          '-y',
          '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:d=10', // 10 seconds
          '-f', 'lavfi', '-i', 'anullsrc=cl=stereo:r=44100',
          '-c:v', 'libx264',
          '-tune', 'stillimage',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-shortest',
          fallbackPath
        ]);

        ffmpeg.on('error', (err) => {
          console.error('FFmpeg fallback generator failed to spawn:', err.message);
          this.logSystem(`FFmpeg fallback generator failed to spawn: ${err.message}. Ensure FFmpeg is installed and added to PATH.`, 'ERROR').catch(() => {});
          reject(err);
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            console.log('Fallback video generated successfully!');
            this.logSystem('Fallback video generated successfully!', 'INFO');
            resolve(fallbackPath);
          } else {
            reject(new Error(`FFmpeg fallback generator exited with code ${code}`));
          }
        });
      });
    }

    return fallbackPath;
  }

  private async logSystem(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') {
    try {
      await prisma.streamLog.create({
        data: {
          type: 'SYSTEM',
          level,
          message
        }
      });
    } catch (err: any) {
      console.error('Failed to write system log to database:', err.message);
    }
  }

  private async logFfmpeg(message: string) {
    try {
      await prisma.streamLog.create({
        data: {
          type: 'FFMPEG',
          level: 'INFO',
          message
        }
      });
    } catch (err: any) {
      console.error('Failed to write ffmpeg log to database:', err.message);
    }
  }

  public getStats(): StreamStats {
    return this.stats;
  }

  // Start the streaming loop
  public async start() {
    if (this.isRunning) {
      return;
    }
    
    this.isRunning = true;
    this.stats.isActive = true;
    await this.logSystem('Starting stream engine', 'INFO');
    
    // Sync settings in database
    await prisma.streamSettings.updateMany({
      where: { id: 'singleton' },
      data: { isActive: true }
    });

    const activeProject = await prisma.project.findFirst({
      where: { isActive: true }
    });
    if (activeProject) {
      this.stats.projectId = activeProject.id;
    }

    // Start background database config checker
    if (this.dbCheckInterval) {
      clearInterval(this.dbCheckInterval);
    }
    this.dbCheckInterval = setInterval(async () => {
      await this.checkDatabaseUpdates();
    }, 4000);

    // Run loop in background
    this.loop().catch(async (err) => {
      console.error('Stream engine loop crashed:', err);
      await this.logSystem(`Stream loop crashed: ${err.message}`, 'ERROR');
      this.isRunning = false;
      this.stats.isActive = false;
      if (this.dbCheckInterval) {
        clearInterval(this.dbCheckInterval);
        this.dbCheckInterval = null;
      }
    });
  }

  // Stop the streaming loop
  public async stop() {
    this.isRunning = false;
    this.stats.isActive = false;
    await this.logSystem('Stopping stream engine', 'INFO');
    
    await prisma.streamSettings.updateMany({
      where: { id: 'singleton' },
      data: { isActive: false }
    });

    if (this.dbCheckInterval) {
      clearInterval(this.dbCheckInterval);
      this.dbCheckInterval = null;
    }

    this.killFfmpeg();
    this.resetStats();
  }

  // Check database updates in the background (runs while FFmpeg is active)
  private async checkDatabaseUpdates() {
    if (!this.isRunning || !this.ffmpegProcess) return;

    try {
      // 1. Fetch current active project from DB
      const project = await prisma.project.findFirst({
        where: { isActive: true }
      });

      if (!project) {
        await this.stop();
        return;
      }

      // 2. Compare stream settings
      if (
        project.preset !== this.currentPreset ||
        project.rtmpUrl !== this.currentRtmpUrl ||
        project.streamKey !== this.currentStreamKey
      ) {
        console.log('Stream settings changed in database. Restarting stream to apply...');
        await this.logSystem('Stream settings updated. Restarting FFmpeg process to apply changes.', 'INFO');
        this.killFfmpeg();
        return;
      }

      // 3. Fetch active project videos
      const activeProject = await prisma.project.findFirst({
        where: { id: project.id },
        include: {
          projectVideos: {
            orderBy: { position: 'asc' },
            include: { video: true }
          }
        }
      });

      const availableVideos = activeProject?.projectVideos
        .map(pv => pv.video)
        .filter(v => v.status === 'READY') || [];

      const videoIds = availableVideos.map(v => v.id);

      // Compare active project ID or video list changes
      const projectIdChanged = project.id !== this.currentPlaylistId;
      const videoListChanged = JSON.stringify(videoIds) !== JSON.stringify(this.currentPlaylistVideoIds);

      if (projectIdChanged || videoListChanged) {
        console.log('Project or videos changed in database. Restarting stream to apply...');
        await this.logSystem('Project structure or active videos modified. Restarting FFmpeg process.', 'INFO');
        this.killFfmpeg();
      }

    } catch (err: any) {
      console.error('Error in background database checker:', err.message);
    }
  }

  // Skip the current video
  public async skip() {
    if (!this.isRunning || !this.ffmpegProcess) {
      return;
    }
    await this.logSystem('Skip video requested by user', 'INFO');
    this.isSkipping = true;
    this.killFfmpeg();
  }

  private killFfmpeg() {
    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.kill('SIGTERM');
      } catch (err) {}
      this.ffmpegProcess = null;
    }
  }

  private resetStats() {
    this.stats.currentVideo = null;
    this.stats.nextVideo = null;
    this.stats.bitrate = 0;
    this.stats.fps = 0;
    this.stats.elapsed = 0;
    this.stats.duration = 0;
    this.stats.isFallback = false;
  }

  // Core stream loop
  private async loop() {
    while (this.isRunning) {
      let videoToPlay: { id: string; name: string; filepath: string; duration: number } | null = null;
      let isFallback = false;

      try {
        // 1. Fetch active project
        const project = await prisma.project.findFirst({
          where: { isActive: true },
          include: {
            projectVideos: {
              orderBy: { position: 'asc' },
              include: { video: true }
            }
          }
        });

        if (!project) {
          console.log('No active project found in DB. Exiting loop.');
          this.isRunning = false;
          this.stats.isActive = false;
          break;
        }

        let isInfiniteLoop = false;

        if (project.mode === 'EXTERNAL' && project.externalUrl) {
          try {
            console.log(`Extracting stream URL for external link: ${project.externalUrl}`);
            const ytDlpOptions: any = { 
              getUrl: true,
              extractorArgs: 'youtube:player_client=tv,web', // tv works without JS runtime, web as fallback
              jsRuntimes: 'node'
            };
            
            if (fs.existsSync('/app/cookies.txt')) {
              ytDlpOptions.cookies = '/app/cookies.txt';
              console.log('Using cookies.txt from /app for yt-dlp authentication.');
            } else if (fs.existsSync('/storage/cookies.txt')) {
              ytDlpOptions.cookies = '/storage/cookies.txt';
              console.log('Using cookies.txt from /storage for yt-dlp authentication.');
            }
            
            const ytOutput = await youtubedl(project.externalUrl, ytDlpOptions);
            
            // yt-dlp might return multiple URLs (e.g. video and audio). We just take the first one or the combined one.
            const streamUrl = typeof ytOutput === 'string' ? ytOutput.split('\n')[0].trim() : String(ytOutput);

            videoToPlay = {
              id: 'external',
              name: 'External Stream: ' + project.externalUrl,
              filepath: streamUrl,
              duration: 0
            };
            this.stats.nextVideo = null;
            isFallback = false;
            isInfiniteLoop = false;
          } catch (err: any) {
            console.error('Failed to extract external stream:', err.message);
            await this.logSystem(`Failed to extract external stream: ${err.message}`, 'ERROR');
            isFallback = true;
          }
        }

        const availableVideos = project.projectVideos
          ? project.projectVideos.map((pv: any) => pv.video).filter((v: any) => v.status === 'READY')
          : [];

        if (!videoToPlay && !isFallback) {
          if (availableVideos.length > 0) {
            // Find which video to play
            const lastVideoId = project.currentVideoId;
            let selectedVideo = availableVideos[0]; // Default to first

            if (lastVideoId) {
              const lastIndex = availableVideos.findIndex((v: any) => v.id === lastVideoId);
              
              if (lastIndex !== -1) {
                const nextIndex = (lastIndex + 1) % availableVideos.length;
                selectedVideo = availableVideos[nextIndex];
              }
            }

            videoToPlay = {
              id: selectedVideo.id,
              name: selectedVideo.name,
              filepath: selectedVideo.filepath,
              duration: selectedVideo.duration
            };

            // Find the next video in sequence for stats
            const currIndex = availableVideos.findIndex((v: any) => v.id === selectedVideo.id);
            let nextVideoObj = availableVideos[0];
            if (currIndex !== -1 && availableVideos.length > 1) {
              nextVideoObj = availableVideos[(currIndex + 1) % availableVideos.length];
            }
            this.stats.nextVideo = {
              id: nextVideoObj.id,
              name: nextVideoObj.name
            };

            isInfiniteLoop = availableVideos.length === 1;
          } else {
            // No ready videos, use fallback
            isFallback = true;
          }
        }

        if (isFallback) {
          const fallbackPath = await this.ensureFallbackVideo();
          videoToPlay = {
            id: 'fallback',
            name: 'Fallback (No ready videos)',
            filepath: fallbackPath,
            duration: 10
          };
          this.stats.nextVideo = null;
          isInfiniteLoop = true;
        }

        if (!videoToPlay) {
          throw new Error('videoToPlay is null unexpectedly');
        }

        // 3. Update active video in DB (if not fallback and not external)
        if (!isFallback && videoToPlay.id !== 'external') {
          await prisma.project.update({
            where: { id: project.id },
            data: { currentVideoId: videoToPlay.id }
          });
        }

        // 4. Double check file exists (only for local files)
        if (videoToPlay.id !== 'external' && !fs.existsSync(videoToPlay.filepath)) {
          throw new Error(`Video file does not exist on disk: ${videoToPlay.filepath}`);
        }

        // 5. Run stream
        this.stats.currentVideo = {
          id: videoToPlay.id,
          name: videoToPlay.name,
          duration: videoToPlay.duration
        };
        this.stats.duration = videoToPlay.duration;
        this.stats.isFallback = isFallback;
        this.stats.projectId = project.id;
        this.isSkipping = false;

        // Store current config to detect changes during playback
        this.currentPlaylistId = project.id;
        this.currentPlaylistVideoIds = availableVideos.map(v => v.id);
        this.currentPreset = project.preset;
        this.currentRtmpUrl = project.rtmpUrl;
        this.currentStreamKey = project.streamKey;

        const startTime = Date.now();
        // Force CPU preset for fallback video to guarantee RTMP compatibility
        const presetToUse = isFallback ? 'CPU' : project.preset;
        await this.runFfmpeg(videoToPlay.filepath, project.rtmpUrl, project.streamKey, presetToUse, isInfiniteLoop);
        
        const durationPlayed = (Date.now() - startTime) / 1000;
        
        // If FFmpeg exited in less than 3 seconds (and we didn't skip it),
        // it indicates a severe issue with the stream (e.g. wrong key, network down, corrupt video)
        if (durationPlayed < 3 && !this.isSkipping) {
          await this.logSystem(`Video "${videoToPlay.name}" stopped streaming too quickly (played ${durationPlayed.toFixed(1)}s). Checking for corruptions or network issues.`, 'WARN');
          
          if (!isFallback && videoToPlay.id !== 'external') {
            await prisma.video.update({
              where: { id: videoToPlay.id },
              data: { 
                status: 'FAILED',
                errorMessage: 'Stopped streaming immediately. Might be corrupted or failed to decode.'
              }
            });
          }
          
          await new Promise(r => setTimeout(r, 3000));
        }

      } catch (err: any) {
        console.error('Error in stream loop iteration:', err.message);
        await this.logSystem(`Stream iteration failed: ${err.message}`, 'ERROR');
        this.resetStats();
        
        await new Promise(r => setTimeout(r, 4000));
      }
    }

    console.log('Stream loop exited.');
    this.resetStats();
  }

  // Run a single FFmpeg instance for one video
  private runFfmpeg(filePath: string, rtmpUrl: string, streamKey: string, preset: string, isInfiniteLoop: boolean): Promise<void> {
    return new Promise((resolve) => {
      // Auto-upgrade rtmp:// to rtmps:// to bypass port 1935 blocks on cloud hosting providers.
      // rtmps uses port 443 (HTTPS) which is never blocked. YouTube supports both.
      const secureUrl = rtmpUrl.replace(/^rtmp:\/\//, 'rtmps://');
      const destination = `${secureUrl}/${streamKey}`;
      let args: string[] = [];

      // Build preset arguments
      // All presets use -re to stream at native speed
      if (preset === 'COPY') {
        args = ['-re'];
        if (isInfiniteLoop) {
          args.push('-stream_loop', '-1');
        }
        args.push(
          '-i', filePath,
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-f', 'flv',
          destination
        );
      } else {
        // Transcoding presets
        let videoBitrate = '3500k';
        let audioBitrate = '128k';
        let resolution = '1280:720';

        if (preset === '1080P') {
          videoBitrate = '6000k';
          resolution = '1920:1080';
        } else if (preset === '480P') {
          videoBitrate = '1500k';
          audioBitrate = '96k';
          resolution = '854:480';
        }

        args = ['-re'];
        if (isInfiniteLoop) {
          args.push('-stream_loop', '-1');
        }
        args.push(
          '-i', filePath,
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-b:v', videoBitrate,
          '-maxrate', videoBitrate,
          '-bufsize', videoBitrate === '6000k' ? '12000k' : '7000k',
          '-pix_fmt', 'yuv420p',
          '-r', '30',
          '-g', '60',
          '-vf', `scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
          '-c:a', 'aac',
          '-b:a', audioBitrate,
          '-ar', '44100',
          '-f', 'flv',
          destination
        );
      }

      console.log(`Starting FFmpeg with command: ffmpeg ${args.join(' ')}`);
      this.logSystem(`Streaming video: "${path.basename(filePath)}" with preset: ${preset}`, 'INFO').catch(() => {});

      this.ffmpegProcess = spawn(ffmpegBinary, args);

      this.ffmpegProcess.on('error', (err) => {
        console.error('FFmpeg process failed to spawn:', err.message);
        this.logSystem(`FFmpeg failed to start: ${err.message}. Ensure FFmpeg is installed and added to PATH.`, 'ERROR').catch(() => {});
        this.ffmpegProcess = null;
        resolve();
      });

      // Parse FFmpeg stderr output for progress logs and stats
      let stderrBuffer = '';
      this.ffmpegProcess.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderrBuffer += chunk;
        // Always print raw ffmpeg output for EasyPanel visibility
        process.stdout.write(`[FFmpeg] ${chunk}`);

        // Parse stats line
        // frame=  123 fps= 30 q=-1.0 size=    1234kB time=00:00:04.12 bitrate=2400.1kbits/s speed= 1x
        const lines = stderrBuffer.split('\r');
        stderrBuffer = lines.pop() || ''; // Keep the last incomplete line

        for (const line of lines) {
          const cleanLine = line.trim();
          if (cleanLine === '') continue;

          // Parse stats
          const fpsMatch = cleanLine.match(/fps=\s*(\d+)/);
          const timeMatch = cleanLine.match(/time=\s*(\d+:\d+:\d+\.\d+)/);
          const bitrateMatch = cleanLine.match(/bitrate=\s*(\d+\.?\d*)\s*kbits\/s/);

          if (fpsMatch) this.stats.fps = parseInt(fpsMatch[1], 10);
          if (bitrateMatch) this.stats.bitrate = parseFloat(bitrateMatch[1]);
          if (timeMatch) {
            const totalElapsed = this.parseTimeString(timeMatch[1]);
            this.stats.elapsed = isInfiniteLoop && this.stats.duration > 0
              ? totalElapsed % this.stats.duration
              : totalElapsed;
          }

          // Write occasional logs to database for debug (only errors or warnings)
          if (cleanLine.toLowerCase().includes('error') || cleanLine.toLowerCase().includes('warning') || cleanLine.toLowerCase().includes('rtmp') || cleanLine.toLowerCase().includes('connection')) {
            console.error(`[FFmpeg] ${cleanLine}`);
            this.logFfmpeg(cleanLine).catch(() => {});
          }
        }
      });

      this.ffmpegProcess.on('close', (code, signal) => {
        console.log(`FFmpeg process closed with code ${code}, signal: ${signal}`);
        const exitMsg = `FFmpeg closed. Code: ${code}, Signal: ${signal} ${this.isSkipping ? '(User skipped)' : ''}`;
        this.logSystem(exitMsg, code === 0 || code === 255 ? 'INFO' : 'ERROR').catch(() => {});
        
        this.ffmpegProcess = null;
        resolve();
      });
    });
  }

  // Parse time format hh:mm:ss.xx into seconds
  private parseTimeString(timeStr: string): number {
    const parts = timeStr.split(':');
    if (parts.length !== 3) return 0;
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  // Resume stream on server startup
  public async autoResume() {
    const settings = await prisma.streamSettings.findUnique({
      where: { id: 'singleton' }
    });

    if (settings && settings.isActive) {
      console.log('Detected active stream on startup. Auto-resuming...');
      await this.logSystem('Server reboot detected. Auto-resuming 24/7 live stream.', 'INFO');
      this.start();
    }
  }
}

export const streamEngine = new StreamEngine();
