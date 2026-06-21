import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
// @ts-ignore
import ffmpegPath from 'ffmpeg-static';
// @ts-ignore
import ffprobeStatic from 'ffprobe-static';
import { prisma } from './db.js';

const ffmpegBinary = ffmpegPath || 'ffmpeg';
const ffprobeBinary = ffprobeStatic?.path || 'ffprobe';

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

// Extract video metadata using ffprobe
export function probeVideo(filePath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn(ffprobeBinary, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath
    ]);

    let stdout = '';
    let stderr = '';

    ffprobe.on('error', (err) => {
      console.error('ffprobe spawn error:', err);
      reject(new Error(`ffprobe could not be started: ${err.message}. Make sure ffprobe is installed and added to PATH.`));
    });

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited with code ${code}. Stderr: ${stderr}`));
      }
      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0];
        const format = data.format;
        
        const duration = parseFloat(format?.duration || stream?.duration || '0');
        const width = parseInt(stream?.width || '1280', 10);
        const height = parseInt(stream?.height || '720', 10);

        resolve({ duration, width, height });
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Transcode video to standard 720p H264 AAC at 30fps
export function transcodeVideo(videoId: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const video = await prisma.video.findUnique({ where: { id: videoId } });
      if (!video || !video.originalPath) {
        throw new Error('Video not found or original path missing');
      }

      await prisma.video.update({
        where: { id: videoId },
        data: { status: 'PROCESSING' }
      });

      // Destination transcoded file path
      const targetDir = path.dirname(video.filepath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // We transcode to a standard 1280x720, 30fps H264 video, 128k AAC audio
      // This allows direct copy streaming without high CPU overhead.
      const ffmpegArgs = [
        '-y', // Overwrite files
        '-i', video.originalPath,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-r', '30',
        '-g', '60', // Keyframe every 2 seconds (30fps * 2)
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '2',
        video.filepath
      ];

      const ffmpeg = spawn(ffmpegBinary, ffmpegArgs);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('error', async (err) => {
        console.error('FFmpeg spawn error:', err);
        try {
          await prisma.video.update({
            where: { id: videoId },
            data: {
              status: 'FAILED',
              errorMessage: `FFmpeg could not be started: ${err.message}. Make sure FFmpeg is installed and added to your system PATH.`
            }
          });
        } catch (dbErr) {
          console.error('Failed to update video status in DB on spawn error:', dbErr);
        }
        reject(err);
      });

      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          console.error(`FFmpeg transcoding failed with code ${code}. Error: ${stderr}`);
          await prisma.video.update({
            where: { id: videoId },
            data: {
              status: 'FAILED',
              errorMessage: `FFmpeg transcoding failed (code ${code}): ${stderr.slice(-500)}`
            }
          });
          return reject(new Error(`FFmpeg exited with code ${code}`));
        }

        try {
          // Get metadata of transcoded file
          const meta = await probeVideo(video.filepath);

          // Update database status
          await prisma.video.update({
            where: { id: videoId },
            data: {
              status: 'READY',
              duration: meta.duration,
              width: meta.width,
              height: meta.height,
              size: fs.statSync(video.filepath).size
            }
          });

          // Delete original file to save space
          if (video.originalPath && fs.existsSync(video.originalPath)) {
            fs.unlinkSync(video.originalPath);
          }

          resolve();
        } catch (err: any) {
          console.error('Metadata parsing after transcoding failed:', err);
          await prisma.video.update({
            where: { id: videoId },
            data: {
              status: 'FAILED',
              errorMessage: `Metadata parsing error: ${err.message}`
            }
          });
          reject(err);
        }
      });
    } catch (error: any) {
      console.error('Transcode background process error:', error);
      await prisma.video.update({
        where: { id: videoId },
        data: {
          status: 'FAILED',
          errorMessage: error.message
        }
      });
      reject(error);
    }
  });
}
