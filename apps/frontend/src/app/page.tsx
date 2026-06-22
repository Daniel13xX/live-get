"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Radio, 
  Film, 
  ListMusic, 
  Settings, 
  Terminal, 
  Play, 
  Square, 
  SkipForward, 
  UploadCloud, 
  Trash2, 
  Edit3, 
  Check, 
  Eye, 
  X, 
  LogOut, 
  Lock, 
  User as UserIcon,
  Video as VideoIcon,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  Sparkles,
  Server
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

import { apiFetch, apiUpload, getApiUrl, getWsUrl } from '../utils/api';

// Helper to format bytes
function formatBytes(bytes: number | bigint): string {
  const b = Number(bytes);
  if (b === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper to format seconds to hh:mm:ss
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [
    h > 0 ? h : null,
    h > 0 ? String(m).padStart(2, '0') : m,
    String(s).padStart(2, '0')
  ].filter(x => x !== null).join(':');
}

function LottieLogo({ style }: { style?: React.CSSProperties }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let anim: any;
    import('lottie-web').then((lottieModule) => {
      const lottie = lottieModule.default;
      if (containerRef.current) {
        anim = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          path: '/logo-animation.json'
        });
      }
    }).catch(err => console.error('Lottie load error:', err));

    return () => {
      if (anim) anim.destroy();
    };
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', ...style }} />;
}

export default function AdminDashboard() {
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [adminUser, setAdminUser] = useState<any>(null);

  // Tab State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'library' | 'playlists' | 'settings' | 'logs'>('dashboard');

  // Video Library State
  const [videos, setVideos] = useState<any[]>([]);
  const [videosLoading, setVideosLoading] = useState<boolean>(false);
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [editingVideoName, setEditingVideoName] = useState<string>('');
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  
  // Drag & Drop Upload State
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string>('');

  // Projects State
  const [projects, setProjects] = useState<any[]>([]);
  const [editingProject, setEditingProject] = useState<any | null>(null);
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showAddVideoModal, setShowAddVideoModal] = useState<boolean>(false);
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [newProjectMode, setNewProjectMode] = useState<'LOCAL' | 'EXTERNAL'>('LOCAL');
  const [newProjectExternalUrl, setNewProjectExternalUrl] = useState<string>('');
  const [projectLoading, setProjectLoading] = useState<boolean>(false);
  const [thumbnailUploading, setThumbnailUploading] = useState<boolean>(false);

  // Stream Settings State
  const [rtmpUrl, setRtmpUrl] = useState<string>('rtmp://a.rtmp.youtube.com/live2');
  const [streamKey, setStreamKey] = useState<string>('');
  const [showStreamKey, setShowStreamKey] = useState<boolean>(false);
  const [streamPreset, setStreamPreset] = useState<string>('COPY');
  const [settingsLoading, setSettingsLoading] = useState<boolean>(false);
  const [settingsMessage, setSettingsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Uptime Stats
  const [uptimeStats, setUptimeStats] = useState<any>(null);

  // Live WebSocket State
  const [streamStatus, setStreamStatus] = useState<any>({
    isActive: false,
    workerOnline: false,
    currentVideo: null,
    nextVideo: null,
    bitrate: 0,
    fps: 0,
    elapsed: 0,
    duration: 0,
    isFallback: false
  });
  const [liveLogs, setLiveLogs] = useState<any[]>([]);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const dashboardLogsRef = useRef<HTMLDivElement | null>(null);
  const fullLogsRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // Check authentication on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      checkAuth();
    } else {
      setAuthLoading(false);
    }
  }, []);

  // Sync data once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchLibraryData();
      fetchProjectData();
      fetchSettingsData();
      fetchUptimeStats();
      connectWebSocket();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [isAuthenticated]);

  // Scroll to bottom of terminal containers when logs update
  useEffect(() => {
    if (!autoScroll) return;
    if (activeTab === 'dashboard' && dashboardLogsRef.current) {
      dashboardLogsRef.current.scrollTop = dashboardLogsRef.current.scrollHeight;
    } else if (activeTab === 'logs' && fullLogsRef.current) {
      fullLogsRef.current.scrollTop = fullLogsRef.current.scrollHeight;
    }
  }, [liveLogs, activeTab, autoScroll]);

  // Auto-poll videos status while any video is converting
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const hasActiveTranscode = videos.some(v => v.status === 'PENDING' || v.status === 'PROCESSING');
    if (!hasActiveTranscode) return;

    const interval = setInterval(() => {
      fetchLibraryData();
    }, 5000);

    return () => clearInterval(interval);
  }, [videos, isAuthenticated]);

  // ------------------ API Functions ------------------

  const checkAuth = async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      setAdminUser(res.user);
      setIsAuthenticated(true);
    } catch (err) {
      localStorage.removeItem('token');
      setIsAuthenticated(false);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      localStorage.setItem('token', res.token);
      setAdminUser(res.user);
      setIsAuthenticated(true);
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setAdminUser(null);
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  const fetchLibraryData = async () => {
    setVideosLoading(true);
    try {
      const data = await apiFetch('/api/videos');
      setVideos(data);
    } catch (err) {
      console.error('Failed to load videos:', err);
    } finally {
      setVideosLoading(false);
    }
  };

  const fetchProjectData = async () => {
    setProjectLoading(true);
    try {
      const data = await apiFetch('/api/projects');
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setProjectLoading(false);
    }
  };

  const fetchSettingsData = async () => {
    setSettingsLoading(true);
    try {
      const settings = await apiFetch('/api/settings');
      setRtmpUrl(settings.rtmpUrl);
      setStreamKey(settings.streamKey);
      setStreamPreset(settings.preset);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setSettingsLoading(false);
    }
  };

  const fetchUptimeStats = async () => {
    try {
      const stats = await apiFetch('/api/stream/uptime');
      setUptimeStats(stats);
    } catch (err) {}
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsMessage(null);
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rtmpUrl, streamKey, preset: streamPreset })
      });
      setSettingsMessage({ type: 'success', text: 'Streaming settings saved successfully!' });
      setTimeout(() => setSettingsMessage(null), 3000);
    } catch (err: any) {
      setSettingsMessage({ type: 'error', text: err.message || 'Failed to save settings' });
    }
  };

  // Video Actions
  const handleRenameVideo = async (id: string) => {
    if (!editingVideoName.trim()) return;
    try {
      await apiFetch(`/api/videos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingVideoName })
      });
      setEditingVideoId(null);
      fetchLibraryData();
    } catch (err) {
      console.error('Failed to rename video:', err);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    if (!confirm('Deseja realmente excluir este vídeo? Ele será removido de todas as playlists de projetos.')) return;
    try {
      await apiFetch(`/api/videos/${id}`, { method: 'DELETE' });
      fetchLibraryData();
      fetchProjectData();
    } catch (err) {
      console.error('Failed to delete video:', err);
    }
  };

  // Project Actions
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    if (newProjectMode === 'EXTERNAL' && !newProjectExternalUrl.trim()) return;
    try {
      const project = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: newProjectName, 
          mode: newProjectMode, 
          externalUrl: newProjectExternalUrl 
        })
      });
      setNewProjectName('');
      setNewProjectMode('LOCAL');
      setNewProjectExternalUrl('');
      setShowCreateModal(false);
      fetchProjectData();
      setEditingProject(project);
    } catch (err) {
      console.error('Failed to create project:', err);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Deseja realmente excluir este projeto? A transmissão associada será interrompida.')) return;
    try {
      await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (editingProject?.id === id) {
        setEditingProject(null);
      }
      fetchProjectData();
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const handleUpdateProjectSettings = async (id: string, updateData: any) => {
    try {
      await apiFetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      fetchProjectData();
      fetchUptimeStats();
    } catch (err) {
      console.error('Failed to update project settings:', err);
    }
  };

  const handleSaveProjectVideos = async (projectId: string, videoIds: string[]) => {
    try {
      await apiFetch(`/api/projects/${projectId}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds })
      });
      fetchProjectData();
    } catch (err) {
      console.error('Failed to update project videos:', err);
    }
  };

  const handleUploadThumbnail = async (projectId: string, file: File) => {
    setThumbnailUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const token = localStorage.getItem('token');
      const res = await fetch(`${getApiUrl()}/api/projects/${projectId}/thumbnail`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      if (!res.ok) {
        throw new Error('Upload falhou');
      }
      fetchProjectData();
    } catch (err) {
      console.error(err);
      alert('Falha ao enviar a imagem de capa.');
    } finally {
      setThumbnailUploading(false);
    }
  };

  // Streaming Actions
  const handleStartStream = async () => {
    try {
      await apiFetch('/api/stream/start', { method: 'POST' });
      fetchUptimeStats();
    } catch (err: any) {
      alert(err.message || 'Falha ao iniciar a transmissão');
    }
  };

  const handleStartStreamForProject = async (projectId: string) => {
    try {
      const currentActive = projects.find(p => p.isActive);
      const hasActiveRunning = streamStatus.isActive && streamStatus.workerOnline && currentActive && currentActive.id !== projectId;
      if (hasActiveRunning) {
        if (!confirm(`Isso irá parar a transmissão atual do projeto "${currentActive.name}" e iniciar o projeto novo. Deseja continuar?`)) {
          return;
        }
      }
      
      // 1. Activate the target project
      await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true })
      });
      
      // 2. Refresh local projects list
      await fetchProjectData();
      
      // 3. Start stream
      await apiFetch('/api/stream/start', { method: 'POST' });
      fetchUptimeStats();
    } catch (err: any) {
      alert(err.message || 'Falha ao iniciar a transmissão');
    }
  };


  const handleStopStream = async () => {
    try {
      await apiFetch('/api/stream/stop', { method: 'POST' });
      fetchUptimeStats();
    } catch (err: any) {
      alert(err.message || 'Falha ao parar a transmissão');
    }
  };

  const handleSkipStream = async () => {
    try {
      await apiFetch('/api/stream/skip', { method: 'POST' });
    } catch (err: any) {
      alert(err.message || 'Falha ao pular o vídeo');
    }
  };

  // WebSocket Connection
  const connectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const rawWsUrl = `${getWsUrl()}/api/stream/live-stats`;
    const wsUrl = rawWsUrl.replace(/([^:]\/)\/+/g, '$1');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'update') {
          setStreamStatus(data.status);
          setLiveLogs(data.logs);
        }
      } catch (err) {}
    };

    ws.onclose = () => {
      setWsConnected(false);
      // Auto-reconnect after 3 seconds if still authenticated
      setTimeout(() => {
        const token = localStorage.getItem('token');
        if (token) {
          connectWebSocket();
        }
      }, 3000);
    };
  };

  // Drag and Drop Upload Handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = () => {
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    setUploadError('');

    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    
    await uploadFile(files[0]);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setUploadError('');
    await uploadFile(files[0]);
  };

  const uploadFile = async (file: File) => {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.mp4', '.mkv', '.avi', '.mov'].includes(ext)) {
      setUploadError('Only MP4, MKV, AVI, and MOV files are supported.');
      return;
    }

    // Limit to 2GB
    if (file.size > 2 * 1024 * 1024 * 1024) {
      setUploadError('File exceeds the 2GB limit.');
      return;
    }

    setUploadProgress(0);
    try {
      await apiUpload('/api/videos/upload', file, (percent) => {
        setUploadProgress(percent);
      });
      setUploadProgress(null);
      fetchLibraryData();
    } catch (err: any) {
      setUploadProgress(null);
      setUploadError(err.message || 'Upload failed');
    }
  };

  // Drag and Drop Project Videos Reordering
  const handleProjectDragEnd = (result: any) => {
    if (!result.destination) return;
    if (!editingProject) return;

    const currentProject = projects.find(p => p.id === editingProject.id);
    if (!currentProject) return;

    const reorderedVideos = Array.from(currentProject.projectVideos);
    const [removed] = reorderedVideos.splice(result.source.index, 1);
    reorderedVideos.splice(result.destination.index, 0, removed);

    // Update locally first for fluid UX
    const updatedProjects = projects.map(p => {
      if (p.id === editingProject.id) {
        return {
          ...p,
          projectVideos: reorderedVideos
        };
      }
      return p;
    });
    setProjects(updatedProjects);

    // Push to API
    const videoIds = reorderedVideos.map((pv: any) => pv.videoId);
    handleSaveProjectVideos(editingProject.id, videoIds);
  };

  const handleAddVideoToProject = (videoId: string) => {
    if (!editingProject) return;
    const currentProject = projects.find(p => p.id === editingProject.id);
    if (!currentProject) return;

    const currentVideoIds = currentProject.projectVideos.map((pv: any) => pv.videoId);
    const updatedVideoIds = [...currentVideoIds, videoId];

    handleSaveProjectVideos(editingProject.id, updatedVideoIds);
  };

  const handleRemoveVideoFromProject = (index: number) => {
    if (!editingProject) return;
    const currentProject = projects.find(p => p.id === editingProject.id);
    if (!currentProject) return;

    const reorderedVideos = Array.from(currentProject.projectVideos);
    reorderedVideos.splice(index, 1);

    const videoIds = reorderedVideos.map((pv: any) => pv.videoId);
    handleSaveProjectVideos(editingProject.id, videoIds);
  };


  // ------------------ Render Login ------------------

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen w-full bg-main" style={{ minHeight: '100vh' }}>
        <Loader2 className="animate-spin text-primary" size={48} />
        <p className="mt-4 text-secondary">Carregando painel...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen w-full login-bg p-4">
        <div className="w-full max-w-sm p-8 flex flex-col gap-6 login-card">
          
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center justify-center mb-2" style={{ width: '220px', height: '100px', overflow: 'hidden', position: 'relative' }}>
              <LottieLogo style={{ transform: 'scale(1.4)', transformOrigin: 'center' }} />
            </div>
            <p className="text-[10px] text-muted font-bold tracking-widest uppercase mt-2">Transmissão 24/7 Looping</p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-secondary uppercase tracking-widest">Usuário Admin</label>
              <input
                type="text"
                required
                placeholder="admin"
                className="text-input w-full"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-secondary uppercase tracking-widest">Senha</label>
              <input
                type="password"
                required
                placeholder="Senha de acesso"
                className="text-input w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {loginError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-red-400 p-3 rounded-lg text-xs flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button type="submit" className="gradient-btn w-full mt-2 py-3 login-btn">
              Acessar Painel
            </button>
          </form>
          
          <div className="text-center text-[10px] text-muted">
            Solução autogerenciável para YouTube Live
          </div>
        </div>
      </div>
    );
  }

  // ------------------ Render Dashboard (Main UI) ------------------

  const activeProject = projects.find(p => p.isActive);

  return (
    <div className="flex min-h-screen bg-main" style={{ minHeight: '100vh' }}>
      
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-border-color bg-surface backdrop-blur-md flex flex-col justify-between shrink-0">
        <div>
          {/* Logo */}
          <div className="border-b border-border-color logo-container flex items-center justify-center" style={{ height: '80px', overflow: 'hidden', padding: '10px' }}>
            <LottieLogo style={{ maxWidth: '180px', transform: 'scale(1.4)', transformOrigin: 'center' }} />
          </div>

          {/* Navigation Links */}
          <nav className="p-4 flex flex-col gap-1.5">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 ${
                activeTab === 'dashboard'
                  ? 'bg-indigo-500/10 text-primary border-l-4 border-primary shadow-[inset_0_0_12px_rgba(99,102,241,0.08)]'
                  : 'text-secondary hover:text-primary hover:bg-white/5'
              }`}
            >
              <Activity size={18} />
              <span>Painel Geral</span>
            </button>

            <button
              onClick={() => setActiveTab('library')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 ${
                activeTab === 'library'
                  ? 'bg-indigo-500/10 text-primary border-l-4 border-primary shadow-[inset_0_0_12px_rgba(99,102,241,0.08)]'
                  : 'text-secondary hover:text-primary hover:bg-white/5'
              }`}
            >
              <Film size={18} />
              <span>Biblioteca de Vídeos</span>
            </button>

            <button
              onClick={() => setActiveTab('playlists')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 ${
                activeTab === 'playlists'
                  ? 'bg-indigo-500/10 text-primary border-l-4 border-primary shadow-[inset_0_0_12px_rgba(99,102,241,0.08)]'
                  : 'text-secondary hover:text-primary hover:bg-white/5'
              }`}
            >
              <Server size={18} />
              <span>Projetos</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 ${
                activeTab === 'settings'
                  ? 'bg-indigo-500/10 text-primary border-l-4 border-primary shadow-[inset_0_0_12px_rgba(99,102,241,0.08)]'
                  : 'text-secondary hover:text-primary hover:bg-white/5'
              }`}
            >
              <Settings size={18} />
              <span>Configurações</span>
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 ${
                activeTab === 'logs'
                  ? 'bg-indigo-500/10 text-primary border-l-4 border-primary shadow-[inset_0_0_12px_rgba(99,102,241,0.08)]'
                  : 'text-secondary hover:text-primary hover:bg-white/5'
              }`}
            >
              <Terminal size={18} />
              <span>Terminal & Logs</span>
            </button>
          </nav>
        </div>

        {/* User Card */}
        <div className="p-4 border-t border-border-color flex items-center justify-between bg-black/10">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-indigo-500/10 flex items-center justify-center border border-primary/20 text-primary font-bold text-sm">
              A
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-primary">{adminUser?.username || 'Admin'}</span>
              <span className="text-[9px] text-success font-semibold tracking-wider flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-success"></span> Online
              </span>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="h-8 w-8 rounded-lg text-muted hover:text-red-400 hover:bg-red-500/10 flex items-center justify-center transition-colors"
            title="Sair"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-y-auto p-8 max-w-7xl mx-auto w-full">
        
        {/* Top Header */}
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-primary tracking-tight">
              {activeTab === 'dashboard' && 'Painel de Controle'}
              {activeTab === 'library' && 'Biblioteca de Vídeos'}
              {activeTab === 'playlists' && 'Gerenciamento de Projetos'}
              {activeTab === 'settings' && 'Configurações do YouTube'}
              {activeTab === 'logs' && 'Logs do Sistema'}
            </h1>
            <p className="text-sm text-secondary mt-1">
              {activeTab === 'dashboard' && 'Resumo em tempo real da transmissão e da integridade do encoder.'}
              {activeTab === 'library' && 'Carregue, converta e organize sua videoteca local.'}
              {activeTab === 'playlists' && 'Crie e configure seus projetos de transmissão, ordene vídeos e controle o encoder.'}
              {activeTab === 'settings' && 'Configure chaves de transmissão e presets inteligentes de compressão.'}
              {activeTab === 'logs' && 'Histórico completo do watchdog interno e output bruto do FFmpeg.'}
            </p>
          </div>

          {/* Quick status bar */}
          <div className="flex gap-4">
            <div className="glass-panel px-4 py-2.5 flex items-center gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${
                  streamStatus.isActive ? 'pulse-live animate-pulse' : 'pulse-offline'
                }`}></span>
                <span className="font-semibold text-xs uppercase tracking-wider">
                  {streamStatus.isActive ? 'LIVE TRANSMITINDO' : 'OFFLINE'}
                </span>
              </div>
              <div className="h-4 w-[1px] bg-border-color"></div>
              <div className="flex items-center gap-2">
                <Server size={14} className={wsConnected ? 'text-success' : 'text-muted'} />
                <span className="text-xs text-secondary font-medium">
                  {wsConnected ? 'Worker Conectado' : 'Worker Offline'}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* ------------------ TAB 1: DASHBOARD ------------------ */}
        {activeTab === 'dashboard' && (
          <div className="flex flex-col gap-6">
            
            {/* Live Streaming Info Card */}
            <div className="glass-panel p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-[3px] bg-accent-gradient"></div>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                
                {/* Visual player status */}
                <div className="md:col-span-2 flex flex-col gap-3">
                  <div className="h-44 bg-black/40 rounded-xl border border-border-color flex flex-col items-center justify-center relative overflow-hidden">
                    {streamStatus.isActive ? (
                      <>
                        <div className="absolute top-3 left-3 bg-red-500 text-white font-bold text-[10px] px-2 py-0.5 rounded tracking-widest flex items-center gap-1.5 animate-pulse shadow-lg shadow-red-500/20">
                          <span className="h-1.5 w-1.5 rounded-full bg-white"></span> AO VIVO
                        </div>
                        <div className="flex flex-col items-center justify-center p-6 text-center">
                          <Radio className="text-indigo-400 animate-bounce mb-2" size={36} />
                          <h4 className="font-semibold text-primary line-clamp-1">{streamStatus.currentVideo?.name || 'Carregando vídeo...'}</h4>
                          <span className="text-xs text-muted mt-1 font-mono">
                            {formatDuration(streamStatus.elapsed)} / {formatDuration(streamStatus.duration)} ({Math.round((streamStatus.elapsed / (streamStatus.duration || 1)) * 100)}%)
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 text-center text-muted">
                        <Square className="opacity-40 mb-2" size={32} />
                        <h4 className="font-semibold text-secondary">Transmissão Inativa</h4>
                        <p className="text-xs mt-1">Configure uma playlist e inicie a live</p>
                      </div>
                    )}

                    {/* Progress Bar */}
                    {streamStatus.isActive && (
                      <div className="absolute bottom-0 left-0 w-full h-1.5 bg-white/5">
                        <div 
                          className="h-full bg-accent-gradient transition-all duration-300"
                          style={{ width: `${(streamStatus.elapsed / (streamStatus.duration || 1)) * 100}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Stats */}
                <div className="flex flex-col justify-between p-1 bg-black/10 rounded-xl border border-border-color/40 p-4">
                  <div className="flex flex-col gap-4">
                    <div>
                      <span className="text-xs text-muted uppercase font-bold tracking-wider">Bitrate da Live</span>
                      <h3 className="text-2xl font-black text-primary mt-1 font-mono">
                        {streamStatus.isActive ? `${Math.round(streamStatus.bitrate)} kbps` : '0 kbps'}
                      </h3>
                    </div>
                    <div>
                      <span className="text-xs text-muted uppercase font-bold tracking-wider">Frame Rate (FPS)</span>
                      <h3 className="text-2xl font-black text-primary mt-1 font-mono">
                        {streamStatus.isActive ? `${streamStatus.fps} FPS` : '0 FPS'}
                      </h3>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-secondary flex items-center gap-1.5">
                    <Activity className="text-indigo-400" size={14} />
                    <span>Encoder Preset: {streamStatus.preset || 'COPY'}</span>
                  </div>
                </div>

                {/* Playlist & Fallback Info */}
                <div className="flex flex-col justify-between p-1 bg-black/10 rounded-xl border border-border-color/40 p-4">
                  <div className="flex flex-col gap-4">
                    <div>
                      <span className="text-xs text-muted uppercase font-bold tracking-wider">Projeto Ativo</span>
                      <h4 className="text-md font-semibold text-primary mt-1 truncate">
                        {activeProject ? activeProject.name : 'Nenhum projeto ativo'}
                      </h4>
                      {activeProject && (
                        <span className="text-[10px] text-secondary font-medium tracking-wide uppercase">
                          Preset: {activeProject.preset}
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-xs text-muted uppercase font-bold tracking-wider">Próximo Vídeo</span>
                      <h4 className="text-sm font-semibold text-secondary mt-0.5 truncate">
                        {streamStatus.nextVideo ? streamStatus.nextVideo.name : 'Fallback Automático'}
                      </h4>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-secondary flex items-center gap-1.5">
                    <Clock className="text-indigo-400" size={14} />
                    <span>Transição: <span className="font-semibold text-emerald-400">Sem downtime (Buffer)</span></span>
                  </div>
                </div>

              </div>

              {/* Quick Action Controls - Only Uptime Stats */}
              <div className="mt-6 flex flex-wrap justify-between items-center gap-4 pt-6 border-t border-border-color">
                {/* System health metrics */}
                {uptimeStats && (
                  <div className="flex gap-6 text-xs text-secondary font-medium ml-auto">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="text-indigo-400" size={14} />
                      <span>Uptime: <span className="text-primary font-bold">{uptimeStats.successRate}%</span></span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="text-rose-400" size={14} />
                      <span>Erros (24h): <span className="text-primary font-bold">{uptimeStats.errors24h}</span></span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Live Stats Table/Widget */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Quick Logs Stream */}
              <div className="lg:col-span-2 glass-panel p-6 flex flex-col h-[350px]">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <Terminal className="text-primary" size={18} />
                    <h3 className="font-bold text-primary">Terminal de Transmissão (Tempo Real)</h3>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-secondary cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={autoScroll} 
                        onChange={(e) => setAutoScroll(e.target.checked)}
                        className="rounded border-border-color bg-black/40 text-indigo-500 focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5"
                      />
                      <span>Auto-scroll</span>
                    </label>
                    <button 
                      onClick={() => setActiveTab('logs')}
                      className="text-xs text-primary hover:underline font-semibold"
                    >
                      Ver logs completos
                    </button>
                  </div>
                </div>
                
                <div 
                  ref={dashboardLogsRef}
                  className="flex-1 bg-black/50 border border-border-color rounded-xl p-4 font-mono text-xs overflow-y-auto flex flex-col gap-1.5 text-zinc-300"
                >
                  {liveLogs.length === 0 ? (
                    <div className="text-muted italic flex items-center justify-center h-full">
                      Nenhum log disponível. Inicie o streaming para visualizar o output do FFmpeg.
                    </div>
                  ) : (
                    liveLogs.slice(-20).map((log: any, idx: number) => {
                      const isSystem = log.type === 'SYSTEM';
                      const isError = log.level === 'ERROR';
                      return (
                        <div key={log.id || idx} className="leading-relaxed">
                          <span className="text-muted">[{new Date(log.createdAt).toLocaleTimeString()}]</span>{' '}
                          <span className={isSystem ? 'text-indigo-400 font-bold' : isError ? 'text-rose-400 font-bold' : 'text-zinc-300'}>
                            {isSystem ? '[SYSTEM]' : '[FFMPEG]'}
                          </span>{' '}
                          <span className={isError ? 'text-rose-300' : ''}>{log.message}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Playlist Overview */}
              <div className="glass-panel p-6 flex flex-col h-[350px]">
                <div className="flex items-center gap-2 mb-4">
                  <ListMusic className="text-primary" size={18} />
                  <h3 className="font-bold text-primary">Playlist do Projeto Ativo</h3>
                </div>

                <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1">
                  {!activeProject || activeProject.projectVideos.length === 0 ? (
                    <div className="text-muted italic flex items-center justify-center h-full text-center p-4">
                      Nenhum projeto ativo ou playlist vazia.
                    </div>
                  ) : (
                    activeProject.projectVideos.map((pv: any, index: number) => {
                      const isPlaying = streamStatus.isActive && streamStatus.currentVideo?.id === pv.video.id;
                      return (
                        <div 
                          key={pv.id}
                          className={`flex items-center justify-between p-3 rounded-lg border text-sm transition-all ${
                            isPlaying 
                              ? 'bg-indigo-500/10 border-indigo-500/30 shadow-[0_0_12px_rgba(99,102,241,0.1)]' 
                              : 'bg-black/20 border-border-color'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs font-mono text-muted">{index + 1}</span>
                            <div className="min-w-0">
                              <h4 className={`font-semibold truncate ${isPlaying ? 'text-primary' : 'text-secondary'}`}>
                                {pv.video.name}
                              </h4>
                              <span className="text-[10px] text-muted font-mono">{formatDuration(pv.video.duration)}</span>
                            </div>
                          </div>
                          {isPlaying && (
                            <span className="bg-red-500 text-white font-bold text-[9px] px-1.5 py-0.5 rounded tracking-wide animate-pulse uppercase">
                              Tocando
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* ------------------ TAB 2: LIBRARY ------------------ */}
        {activeTab === 'library' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Column: List Videos */}
            <div className="lg:col-span-2 flex flex-col gap-6">
              <div className="glass-panel p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-extrabold text-lg text-primary flex items-center gap-2">
                    <VideoIcon className="text-primary" size={20} />
                    Meus Vídeos ({videos.length})
                  </h3>
                  <button 
                    onClick={fetchLibraryData}
                    className="text-xs text-muted hover:text-primary transition-colors"
                  >
                    Recarregar biblioteca
                  </button>
                </div>

                {videosLoading ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <Loader2 className="animate-spin text-primary" size={36} />
                    <p className="text-secondary text-sm mt-3">Carregando videoteca...</p>
                  </div>
                ) : videos.length === 0 ? (
                  <div className="text-center py-20 border-2 border-dashed border-border-color rounded-xl">
                    <Film className="mx-auto text-muted mb-4 opacity-40" size={48} />
                    <h4 className="font-bold text-secondary">Nenhum vídeo carregado</h4>
                    <p className="text-xs text-muted mt-1 max-w-xs mx-auto">
                      Arraste e solte arquivos de vídeo no painel de upload à direita para adicioná-los ao servidor.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {videos.map((video) => (
                      <div key={video.id} className="p-4 bg-black/20 border border-border-color rounded-xl flex items-center justify-between gap-4 hover:border-border-color-focus/50 transition-all">
                        
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div 
                            className={`h-12 w-12 rounded-lg bg-indigo-500/5 flex items-center justify-center border border-indigo-500/10 text-primary shrink-0 relative overflow-hidden ${video.status === 'READY' ? 'cursor-pointer hover:border-primary transition-colors' : ''}`}
                            onClick={() => {
                              if (video.status === 'READY') {
                                setPreviewVideoUrl(`${getApiUrl()}/api/videos/static/${video.filename}`);
                              }
                            }}
                            title={video.status === 'READY' ? 'Visualizar Vídeo' : undefined}
                          >
                            {video.status === 'READY' ? (
                              <video 
                                src={`${getApiUrl()}/api/videos/static/${video.filename}`}
                                preload="metadata"
                                className="h-full w-full object-cover"
                                muted
                                playsInline
                              />
                            ) : (
                              <Film size={20} />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            {editingVideoId === video.id ? (
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  className="text-input py-1 text-sm flex-1"
                                  value={editingVideoName}
                                  onChange={(e) => setEditingVideoName(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && handleRenameVideo(video.id)}
                                />
                                <button 
                                  onClick={() => handleRenameVideo(video.id)}
                                  className="h-8 w-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center hover:bg-emerald-500/30"
                                >
                                  <Check size={16} />
                                </button>
                                <button 
                                  onClick={() => setEditingVideoId(null)}
                                  className="h-8 w-8 rounded-lg bg-white/5 text-muted flex items-center justify-center hover:bg-white/10"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 min-w-0 w-full">
                                <h4 className="font-semibold text-secondary truncate">{video.name}</h4>
                                <button 
                                  onClick={() => {
                                    setEditingVideoId(video.id);
                                    setEditingVideoName(video.name);
                                  }}
                                  className="text-muted hover:text-primary p-1 shrink-0"
                                  title="Renomear vídeo"
                                >
                                  <Edit3 size={14} />
                                </button>
                              </div>
                            )}

                            <div className="flex items-center gap-3 text-xs text-muted mt-1 font-mono">
                              <span>{formatDuration(video.duration)}</span>
                              <span>•</span>
                              <span>{formatBytes(video.size)}</span>
                              {video.width && video.height && (
                                <>
                                  <span>•</span>
                                  <span>{video.width}x{video.height}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status & Actions */}
                        <div className="flex items-center gap-4">
                          {video.status === 'READY' && (
                            <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1 rounded-full border border-emerald-500/20 flex items-center gap-1.5 font-medium">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Pronto
                            </span>
                          )}
                          {video.status === 'PROCESSING' && (
                            <span className="bg-amber-500/10 text-amber-400 text-xs px-2.5 py-1 rounded-full border border-amber-500/20 flex items-center gap-1.5 font-medium">
                              <Loader2 className="animate-spin" size={12} /> Convertendo...
                            </span>
                          )}
                          {video.status === 'PENDING' && (
                            <span className="bg-zinc-500/10 text-zinc-400 text-xs px-2.5 py-1 rounded-full border border-zinc-500/20 flex items-center gap-1.5 font-medium">
                              Pendente
                            </span>
                          )}
                          {video.status === 'FAILED' && (
                            <span 
                              className="bg-rose-500/10 text-rose-400 text-xs px-2.5 py-1 rounded-full border border-rose-500/20 flex items-center gap-1.5 font-medium cursor-help"
                              title={video.errorMessage || 'Unknown error during transcoding'}
                            >
                              <AlertTriangle size={12} /> Falhou
                            </span>
                          )}

                          <div className="flex gap-1">
                            {video.status === 'READY' && (
                              <button 
                                onClick={() => setPreviewVideoUrl(`${getApiUrl()}/api/videos/static/${video.filename}`)}
                                className="h-9 w-9 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 flex items-center justify-center transition-colors"
                                title="Visualizar Vídeo"
                              >
                                <Eye size={16} />
                              </button>
                            )}
                            <button 
                              onClick={() => handleDeleteVideo(video.id)}
                              className="h-9 w-9 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 flex items-center justify-center transition-colors"
                              title="Remover vídeo"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Upload Files */}
            <div className="flex flex-col gap-6">
              
              {/* Drag and Drop Card */}
              <div 
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`glass-panel p-8 text-center flex flex-col items-center justify-center border-2 border-dashed rounded-xl transition-all cursor-pointer min-h-[300px] ${
                  isDraggingOver 
                    ? 'border-indigo-500 bg-indigo-500/5 shadow-[0_0_15px_rgba(99,102,241,0.15)]' 
                    : 'border-border-color hover:border-indigo-500/50'
                }`}
              >
                <input 
                  type="file" 
                  id="file-upload" 
                  className="hidden" 
                  accept=".mp4,.mkv,.avi,.mov"
                  onChange={handleFileSelect}
                  disabled={uploadProgress !== null}
                />
                <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-indigo-500/5 flex items-center justify-center border border-indigo-500/10 text-primary">
                    {uploadProgress !== null ? (
                      <Loader2 className="animate-spin text-primary" size={32} />
                    ) : (
                      <UploadCloud size={32} />
                    )}
                  </div>
                  
                  {uploadProgress !== null ? (
                    <div className="w-full flex flex-col gap-2">
                      <h4 className="font-bold text-primary">Fazendo upload...</h4>
                      <div className="w-48 h-2 bg-black/40 rounded-full overflow-hidden border border-border-color">
                        <div 
                          className="h-full bg-accent-gradient transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        ></div>
                      </div>
                      <span className="text-xs font-mono text-secondary">{uploadProgress}% concluído</span>
                    </div>
                  ) : (
                    <>
                      <div>
                        <h4 className="font-bold text-primary">Arraste seus vídeos aqui</h4>
                        <p className="text-xs text-muted mt-1">MP4, MKV, AVI ou MOV (Máx: 2GB)</p>
                      </div>
                      <span className="secondary-btn py-2 text-xs">Selecionar Arquivo</span>
                    </>
                  )}
                </label>

                {uploadError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-xs flex items-center gap-1.5 mt-4 w-full">
                    <AlertTriangle size={14} className="shrink-0" />
                    <span className="text-left leading-relaxed">{uploadError}</span>
                  </div>
                )}
              </div>

              {/* Transcode Notice */}
              <div className="glass-panel p-6 bg-indigo-500/[0.02]">
                <h4 className="font-bold text-primary text-sm flex items-center gap-2 mb-2">
                  <Sparkles size={16} /> Encoder Inteligente VPS
                </h4>
                <p className="text-xs text-secondary leading-relaxed">
                  Para otimizar o uso de CPU da VPS, nosso sistema converte automaticamente todos os vídeos carregados para um formato padrão altamente compatível (H.264 720p). Isso permite que a live seja transmitida no modo <strong>Direct Copy</strong>, usando quase <strong>0% de CPU</strong> do servidor durante a live 24/7.
                </p>
              </div>

            </div>

          </div>
        )}

        {activeTab === 'playlists' && (
          <div className="flex flex-col gap-6 w-full">
            
            {/* If not editing, show the Projects Grid */}
            {!editingProject ? (
              <div className="flex flex-col gap-6">
                
                {/* Header Actions */}
                <div className="flex justify-between items-center bg-black/10 p-4 rounded-xl border border-border-color/40">
                  <div>
                    <h3 className="font-bold text-primary flex items-center gap-2">
                      <Server size={18} /> Meus Projetos de Transmissão
                    </h3>
                    <p className="text-xs text-secondary mt-0.5">
                      Cada projeto representa uma transmissão independente com suas próprias configurações de stream e playlist.
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowCreateModal(true)}
                    className="gradient-btn active-action py-2 px-4 text-xs font-bold inline-flex items-center gap-2"
                  >
                    <span>+ Novo Projeto</span>
                  </button>
                </div>

                {/* Projects Grid */}
                {projectLoading && projects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <Loader2 className="animate-spin text-primary" size={36} />
                    <p className="text-secondary text-sm mt-3">Carregando projetos...</p>
                  </div>
                ) : projects.length === 0 ? (
                  <div className="text-center py-20 border-2 border-dashed border-border-color rounded-xl bg-black/10">
                    <Server className="mx-auto text-muted mb-4 opacity-40" size={48} />
                    <h4 className="font-bold text-secondary">Nenhum projeto encontrado</h4>
                    <p className="text-xs text-muted mt-1 max-w-xs mx-auto mb-4">
                      Crie um projeto para começar a configurar sua live.
                    </p>
                    <button 
                      onClick={() => setShowCreateModal(true)}
                      className="gradient-btn py-2 px-4 text-xs"
                    >
                      Criar Primeiro Projeto
                    </button>
                  </div>
                ) : (
                  <div className="project-grid">
                    {projects.map((project) => {
                      const isLive = streamStatus.isActive && project.isActive;
                      const hasVideos = project.projectVideos && project.projectVideos.length > 0;
                      const canStartStream = project.mode === 'EXTERNAL' ? !!project.externalUrl : hasVideos;
                      
                      return (
                        <div 
                          key={project.id} 
                          className={`project-card ${project.isActive ? 'active-project' : ''}`}
                        >
                          {/* Top Border Glow for active project */}
                          {project.isActive && (
                            <div className="absolute top-0 left-0 w-full h-[3px] bg-emerald-500 shadow-[0_1px_8px_rgba(16,185,129,0.5)]"></div>
                          )}

                          {/* Thumbnail / Cover */}
                          <div className="project-card-thumbnail">
                            {project.thumbnail ? (
                              <img src={`${getApiUrl()}${project.thumbnail}`} alt="" />
                            ) : (
                              <div className="flex flex-col items-center justify-center text-muted gap-2">
                                <Server size={28} className="opacity-25" />
                                <span className="text-[9px] uppercase tracking-wider font-bold">Sem Thumbnail</span>
                              </div>
                            )}

                            {/* Badge Overlay */}
                            <div className="absolute top-3 left-3 flex gap-2">
                              {project.isActive ? (
                                isLive ? (
                                  <span className="bg-red-500 text-white font-bold text-[9px] px-2 py-0.5 rounded tracking-widest flex items-center gap-1 animate-pulse shadow-lg shadow-red-500/20">
                                    <span className="h-1.5 w-1.5 rounded-full bg-white"></span> AO VIVO
                                  </span>
                                ) : (
                                  <span className="bg-emerald-500 text-white font-bold text-[9px] px-2 py-0.5 rounded tracking-widest flex items-center gap-1 shadow-lg shadow-emerald-500/20">
                                    <span className="h-1.5 w-1.5 rounded-full bg-white"></span> ATIVO
                                  </span>
                                )
                              ) : (
                                <span className="bg-zinc-850 text-muted font-bold text-[9px] px-2 py-0.5 rounded tracking-widest border border-border-color">
                                  INATIVO
                                </span>
                              )}
                            </div>

                            {/* Delete Button (Overlay on Thumbnail) */}
                            <button 
                              onClick={() => handleDeleteProject(project.id)}
                              className="btn-card-trash"
                              title="Excluir Projeto"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>

                          {/* Project Content */}
                          <div className="project-card-content">
                            <div className="flex flex-col gap-0.5">
                              <h4 className="project-card-title">{project.name}</h4>
                              <p className="project-card-url" title={project.rtmpUrl}>
                                {project.rtmpUrl}
                              </p>
                            </div>

                            <div className="project-card-stats">
                              <div className="project-card-stat-col">
                                <span className="project-card-stat-label">Preset</span>
                                <span className="project-card-stat-value">{project.preset}</span>
                              </div>
                              <div className="project-card-stat-col">
                                <span className="project-card-stat-label">Vídeos</span>
                                <span className="project-card-stat-value">{project.projectVideos?.length || 0}</span>
                              </div>
                            </div>
                          </div>

                          {/* Control Buttons for Project Card */}
                          <div className="project-card-footer-controls">
                            <div className="flex items-center gap-1.5">
                              <span className={`h-2 w-2 rounded-full ${
                                project.isActive 
                                  ? (isLive ? 'bg-red-500 animate-ping' : 'bg-zinc-500') 
                                  : 'bg-zinc-500/60'
                              }`}></span>
                              <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">
                                {project.isActive 
                                  ? (isLive ? 'Transmitindo' : 'Pronto') 
                                  : 'Inativo'
                                }
                              </span>
                            </div>

                            <div className="flex gap-1.5 shrink-0">
                              {project.isActive ? (
                                <>
                                  {!isLive ? (
                                    <button 
                                      onClick={handleStartStream} 
                                      className="gradient-btn active-action btn-card-sm"
                                      disabled={!wsConnected || !canStartStream}
                                      title={!canStartStream ? (project.mode === 'EXTERNAL' ? 'Configure a URL externa antes de transmitir' : 'Adicione vídeos na playlist antes de transmitir') : undefined}
                                    >
                                      <Play size={11} />
                                      <span>Iniciar Live</span>
                                    </button>
                                  ) : (
                                    <button 
                                      onClick={handleStopStream} 
                                      className="danger-btn btn-card-sm"
                                    >
                                      <Square size={11} />
                                      <span>Parar</span>
                                    </button>
                                  )}

                                  <button 
                                    onClick={handleSkipStream} 
                                    className="secondary-btn btn-card-sm"
                                    disabled={!isLive}
                                    title="Pular para o próximo vídeo"
                                  >
                                    <SkipForward size={11} />
                                    <span>Pular</span>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleUpdateProjectSettings(project.id, { isActive: true })}
                                    className="secondary-btn btn-card-sm border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/10"
                                  >
                                    Ativar
                                  </button>
                                  <button 
                                    onClick={() => handleStartStreamForProject(project.id)} 
                                    className="gradient-btn active-action btn-card-sm"
                                    disabled={!wsConnected || !canStartStream}
                                    title={!canStartStream ? (project.mode === 'EXTERNAL' ? 'Configure a URL externa antes de transmitir' : 'Adicione vídeos na playlist antes de transmitir') : undefined}
                                  >
                                    <Play size={11} />
                                    <span>Iniciar Live</span>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="project-card-footer-actions">
                            <button 
                              onClick={() => setEditingProject(project)}
                              className="btn-card-configure"
                            >
                              <Edit3 size={12} />
                              <span>Configurar / Editar</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                )}
              </div>
            ) : (
              /* Editing View (Setup Flow) */
              <div className="flex flex-col gap-6">
                
                {/* Editing Header */}
                <div className="flex justify-between items-center bg-black/10 p-4 rounded-xl border border-border-color/40">
                  <div>
                    <h3 className="font-bold text-primary flex items-center gap-2">
                      <Edit3 size={18} className="text-primary" />
                      Configurando Projeto: <span className="text-emerald-400 font-extrabold">{projects.find(p => p.id === editingProject.id)?.name}</span>
                    </h3>
                    <p className="text-xs text-secondary mt-0.5">
                      Configure os parâmetros RTMP, preset, thumbnail e a playlist de vídeos deste projeto.
                    </p>
                  </div>
                  <button 
                    onClick={() => setEditingProject(null)}
                    className="secondary-btn py-2 px-4 text-xs font-bold inline-flex items-center gap-2"
                  >
                    <span>← Voltar para Projetos</span>
                  </button>
                </div>

                {/* Setup flow two-column layout */}
                {projects.find(p => p.id === editingProject.id) ? (
                  (() => {
                    const currentEditingProject = projects.find(p => p.id === editingProject.id);
                    return (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full">
                        
                        {/* LEFT COLUMN: STEP 1 (RTMP Parameters, Preset, Stream Key, Thumbnail) */}
                        <div className="p-6 bg-black/15 border border-border-color/60 rounded-2xl flex flex-col gap-5 glass-panel">
                          <h4 className="font-bold text-sm text-primary flex items-center gap-2 pb-3 border-b border-border-color/30">
                            <span className="h-6 w-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-mono text-xs">1</span>
                            Parâmetros RTMP & Capa do Projeto
                          </h4>

                          <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-secondary font-semibold">URL do Servidor RTMP</label>
                              <input
                                type="text"
                                className="text-input text-xs"
                                value={currentEditingProject.rtmpUrl}
                                onChange={(e) => handleUpdateProjectSettings(currentEditingProject.id, { rtmpUrl: e.target.value })}
                              />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-secondary font-semibold">Preset do Encoder</label>
                              <select
                                className="text-input text-xs py-1.5"
                                value={currentEditingProject.preset}
                                onChange={(e) => handleUpdateProjectSettings(currentEditingProject.id, { preset: e.target.value })}
                              >
                                <option value="COPY">Direct Copy (Recomendado - 0% CPU)</option>
                                <option value="1080P">Transcode 1080p (6000kbps)</option>
                                <option value="720P">Transcode 720p (3500kbps)</option>
                                <option value="480P">Transcode 480p (1500kbps)</option>
                              </select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs text-secondary font-semibold">Chave de Transmissão (Stream Key)</label>
                              <input
                                type="password"
                                placeholder="Cole sua chave aqui"
                                className="text-input text-xs"
                                value={currentEditingProject.streamKey}
                                onChange={(e) => handleUpdateProjectSettings(currentEditingProject.id, { streamKey: e.target.value })}
                              />
                            </div>

                            {/* Thumbnail Upload */}
                            <div className="flex flex-col gap-2 p-4 bg-black/25 border border-border-color rounded-xl mt-2">
                              <label className="text-xs text-secondary font-semibold">Thumbnail/Capa do Projeto</label>
                              <div className="flex items-center gap-4">
                                <div className="h-16 w-28 bg-black/40 rounded border border-border-color overflow-hidden flex items-center justify-center text-muted">
                                  {currentEditingProject.thumbnail ? (
                                    <img src={`${getApiUrl()}${currentEditingProject.thumbnail}`} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <Film size={24} className="opacity-30" />
                                  )}
                                </div>
                                <div className="flex-1">
                                  <input 
                                    type="file" 
                                    id={`thumb-upload-${currentEditingProject.id}`} 
                                    className="hidden" 
                                    accept="image/*"
                                    onChange={(e) => {
                                      const files = e.target.files;
                                      if (files && files.length > 0) {
                                        handleUploadThumbnail(currentEditingProject.id, files[0]);
                                      }
                                    }}
                                  />
                                  <label htmlFor={`thumb-upload-${currentEditingProject.id}`} className="secondary-btn py-2 text-xs cursor-pointer inline-flex items-center gap-2">
                                    {thumbnailUploading ? <Loader2 className="animate-spin" size={14} /> : <UploadCloud size={14} />}
                                    <span>{currentEditingProject.thumbnail ? 'Alterar Imagem' : 'Upload Thumbnail'}</span>
                                  </label>
                                  <p className="text-[10px] text-muted mt-1.5">Formatos suportados: PNG, JPG, WEBP (Recomendado: 1280x720)</p>
                                </div>
                              </div>
                            </div>

                          </div>
                        </div>

                        {/* RIGHT COLUMN: STEP 2 (Playlist Builder / External Link) */}
                        <div className="p-6 bg-black/15 border border-border-color/60 rounded-2xl flex flex-col gap-5 glass-panel">
                          <h4 className="font-bold text-sm text-primary flex items-center gap-2 pb-3 border-b border-border-color/30">
                            <span className="h-6 w-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-mono text-xs">2</span>
                            {currentEditingProject.mode === 'EXTERNAL' ? 'Fonte do Stream Externo' : 'Playlist de Vídeos do Projeto'}
                          </h4>

                          {currentEditingProject.mode === 'EXTERNAL' ? (
                            <div className="flex flex-col gap-4 mt-1">
                              <p className="text-xs text-muted leading-relaxed">
                                Este projeto está configurado para retransmitir um link externo (como YouTube).
                              </p>
                              <div className="flex flex-col gap-1.5">
                                <label className="text-xs text-secondary font-semibold">URL Externa</label>
                                <textarea
                                  placeholder={"Cole um ou mais links do YouTube (um por linha)\nExemplo:\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://www.youtube.com/watch?v=c1UYzuk_B9E"}
                                  className="text-input text-sm w-full h-24 resize-none font-mono py-2"
                                  value={currentEditingProject.externalUrl || ''}
                                  onChange={(e) => {
                                    handleUpdateProjectSettings(currentEditingProject.id, { externalUrl: e.target.value });
                                    setEditingProject({ ...currentEditingProject, externalUrl: e.target.value });
                                  }}
                                />
                                <span className="text-[10px] text-muted leading-none mt-1">Cole uma URL por linha para retransmiti-las em fila automática.</span>
                              </div>
                            </div>
                          ) : (
                          <div className="flex flex-col gap-4 mt-1">
                            {/* Selected Playlist */}
                            <div className="flex flex-col gap-3">
                              <div className="flex justify-between items-center">
                                <h5 className="text-xs text-muted uppercase font-bold tracking-wider">Fila de Reprodução ({currentEditingProject.projectVideos.length})</h5>
                                <button 
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setShowAddVideoModal(true);
                                  }} 
                                  className="gradient-btn px-3 py-1.5 text-xs font-semibold"
                                >
                                  Adicionar vídeo disponível da biblioteca
                                </button>
                              </div>
                              <DragDropContext onDragEnd={handleProjectDragEnd}>
                                <Droppable droppableId="project-droppable">
                                  {(provided) => (
                                    <div 
                                      {...provided.droppableProps}
                                      ref={provided.innerRef}
                                      className="flex flex-col gap-2 min-h-[300px] bg-black/25 rounded-xl p-3 border border-border-color/60 overflow-y-auto max-h-[380px]"
                                    >
                                      {currentEditingProject.projectVideos.length === 0 ? (
                                        <div className="text-muted text-xs italic text-center py-20 leading-relaxed px-4">
                                          Playlist vazia. Clique no botão acima para adicionar vídeos da biblioteca.
                                        </div>
                                      ) : (
                                        currentEditingProject.projectVideos.map((pv: any, index: number) => (
                                          <Draggable key={pv.id} draggableId={pv.id} index={index}>
                                            {(provided, snapshot) => (
                                              <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                {...provided.dragHandleProps}
                                                className={`p-2.5 bg-black/35 border border-border-color rounded-lg text-xs flex items-center justify-between transition-all ${
                                                  snapshot.isDragging ? 'dragging-item' : 'hover:border-border-color-focus/30'
                                                }`}
                                              >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                  <span className="text-xs font-mono text-muted">{index + 1}</span>
                                                  <div className="min-w-0">
                                                    <h4 className="font-semibold text-secondary truncate">{pv.video.name}</h4>
                                                    <span className="text-[9px] text-muted font-mono">{formatDuration(pv.video.duration)}</span>
                                                  </div>
                                                </div>
                                                <button 
                                                  onClick={() => handleRemoveVideoFromProject(index)}
                                                  className="text-muted hover:text-red-400 p-1"
                                                >
                                                  <Trash2 size={12} />
                                                </button>
                                              </div>
                                            )}
                                          </Draggable>
                                        ))
                                      )}
                                      {provided.placeholder}
                                    </div>
                                  )}
                                </Droppable>
                              </DragDropContext>
                            </div>
                          </div>
                          )}
                        </div>

                      </div>
                    );
                  })()
                ) : (
                  <div className="text-center py-20 border border-border-color rounded-xl">
                    <Loader2 className="animate-spin text-primary mx-auto" size={32} />
                    <p className="text-secondary text-sm mt-3">Carregando dados do projeto...</p>
                  </div>
                )}

              </div>
            )}

            {/* Create Project Modal Overlay */}
            {showCreateModal && (
              <div 
                className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn"
                onClick={() => setShowCreateModal(false)}
              >
                <div 
                  className="glass-panel w-full max-w-md p-6 relative flex flex-col gap-5 rounded-2xl"
                  style={{ background: 'rgba(8, 8, 8, 0.95)', border: '1px solid rgba(255, 0, 85, 0.2)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button 
                    onClick={() => setShowCreateModal(false)}
                    className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/5 text-muted hover:text-primary flex items-center justify-center transition-colors border border-border-color"
                  >
                    <X size={16} />
                  </button>

                  <div>
                    <h3 className="font-bold text-lg text-primary flex items-center gap-2">
                      <Server size={18} /> Novo Projeto Live
                    </h3>
                    <p className="text-xs text-secondary mt-1">
                      Crie um novo projeto de transmissão. Você poderá configurar chaves de stream e a playlist logo a seguir.
                    </p>
                  </div>

                  <form onSubmit={handleCreateProject} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-secondary font-semibold">Nome do Projeto</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: Rádio Eletrônica 24h"
                        className="text-input text-sm w-full"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        autoFocus
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-secondary font-semibold">Modo de Operação</label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-xs text-zinc-300">
                          <input 
                            type="radio" 
                            checked={newProjectMode === 'LOCAL'}
                            onChange={() => setNewProjectMode('LOCAL')}
                            className="bg-black/50 border-border-color text-indigo-500 focus:ring-0"
                          />
                          Biblioteca Local
                        </label>
                        <label className="flex items-center gap-2 text-xs text-zinc-300">
                          <input 
                            type="radio" 
                            checked={newProjectMode === 'EXTERNAL'}
                            onChange={() => setNewProjectMode('EXTERNAL')}
                            className="bg-black/50 border-border-color text-indigo-500 focus:ring-0"
                          />
                          Link Externo (Restream)
                        </label>
                      </div>
                    </div>

                    {newProjectMode === 'EXTERNAL' && (
                      <div className="flex flex-col gap-1.5 animate-fadeIn">
                        <textarea
                          required
                          placeholder={"Cole um ou mais links do YouTube (um por linha)\nExemplo:\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://www.youtube.com/watch?v=c1UYzuk_B9E"}
                          className="text-input text-sm w-full h-24 resize-none font-mono py-2"
                          value={newProjectExternalUrl}
                          onChange={(e) => setNewProjectExternalUrl(e.target.value)}
                        />
                        <span className="text-[10px] text-muted leading-none mt-1">Cole uma URL por linha para criar o projeto com uma fila de transmissão.</span>
                      </div>
                    )}

                    <button type="submit" className="gradient-btn w-full py-2.5 mt-2 text-sm active-action">
                      Criar Projeto
                    </button>
                  </form>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ------------------ TAB 4: SETTINGS ------------------ */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto w-full">
            <div className="glass-panel p-8 relative overflow-hidden text-center flex flex-col items-center justify-center gap-4">
              <div className="absolute top-0 left-0 w-full h-[3px] bg-accent-gradient"></div>
              <Settings size={48} className="text-indigo-400 opacity-80" />
              <h3 className="font-bold text-lg text-primary">Parâmetros de Transmissão</h3>
              <p className="text-xs text-muted max-w-md leading-relaxed">
                As configurações de transmissão (Servidor RTMP, Chave de Transmissão, Preset e Thumbnail) agora são definidas <strong>individualmente por Projeto</strong>. 
              </p>
              <button
                onClick={() => setActiveTab('playlists')}
                className="gradient-btn py-2 px-4 text-xs font-semibold"
              >
                Gerenciar Projetos
              </button>
            </div>
          </div>
        )}

        {/* ------------------ TAB 5: LOGS ------------------ */}
        {activeTab === 'logs' && (
          <div className="flex flex-col gap-6">
            <div className="glass-panel p-6 flex flex-col h-[550px]">
              <div className="flex justify-between items-center mb-4 pb-4 border-b border-border-color">
                <div className="flex items-center gap-2">
                  <Terminal size={20} className="text-primary" />
                  <h3 className="font-extrabold text-lg text-primary">Terminal de Observabilidade</h3>
                </div>
                
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-secondary cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={autoScroll} 
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="rounded border-border-color bg-black/40 text-indigo-500 focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5"
                    />
                    <span>Auto-scroll</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-secondary flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400"></span> SYSTEM
                    </span>
                    <span className="text-xs text-secondary flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-zinc-300"></span> FFMPEG
                    </span>
                  </div>
                </div>
              </div>

              <div 
                ref={fullLogsRef}
                className="flex-1 bg-black/60 border border-border-color rounded-xl p-5 font-mono text-xs overflow-y-auto flex flex-col gap-1.5 text-zinc-300"
              >
                {liveLogs.length === 0 ? (
                  <div className="text-muted italic flex items-center justify-center h-full">
                    Aguardando logs do stream worker...
                  </div>
                ) : (
                  liveLogs.map((log: any, idx: number) => {
                    const isSystem = log.type === 'SYSTEM';
                    const isError = log.level === 'ERROR';
                    return (
                      <div key={log.id || idx} className="leading-relaxed hover:bg-white/5 px-2 py-0.5 rounded transition-colors">
                        <span className="text-muted">[{new Date(log.createdAt).toLocaleString()}]</span>{' '}
                        <span className={isSystem ? 'text-indigo-400 font-bold' : isError ? 'text-rose-400 font-bold' : 'text-zinc-400 font-semibold'}>
                          {isSystem ? '[SYSTEM]' : '[FFMPEG]'}
                        </span>{' '}
                        <span className={isError ? 'text-rose-300' : ''}>{log.message}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Add Video to Playlist Modal Overlay */}
      {showAddVideoModal && (
        <div 
          className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setShowAddVideoModal(false)}
        >
          <div 
            className="glass-panel w-full max-w-lg p-6 relative flex flex-col gap-5 rounded-2xl"
            style={{ background: 'rgba(8, 8, 8, 0.95)', border: '1px solid rgba(255, 0, 85, 0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setShowAddVideoModal(false)}
              className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/5 text-muted hover:text-primary flex items-center justify-center transition-colors border border-border-color"
            >
              <X size={16} />
            </button>

            <div>
              <h3 className="font-bold text-lg text-primary flex items-center gap-2">
                <Film size={18} /> Biblioteca de Vídeos Disponíveis
              </h3>
              <p className="text-xs text-secondary mt-1">
                Selecione um vídeo da biblioteca para adicioná-lo à fila do projeto.
              </p>
            </div>

            <div className="flex flex-col gap-2 bg-black/25 rounded-xl p-3 border border-border-color/60 overflow-y-auto max-h-[380px] min-h-[200px]">
              {videos.filter(v => v.status === 'READY').length === 0 ? (
                <div className="text-muted text-xs italic text-center py-10 px-4 leading-relaxed">
                  Nenhum vídeo disponível. Envie vídeos na guia de biblioteca.
                </div>
              ) : (
                videos.filter(v => v.status === 'READY').map((video) => {
                  const project = projects.find(p => p.id === editingProject);
                  const count = project?.projectVideos?.filter((pv: any) => pv.videoId === video.id).length || 0;
                  return (
                    <div 
                      key={video.id} 
                      onClick={() => {
                        handleAddVideoToProject(video.id);
                        setShowAddVideoModal(false);
                      }}
                      className="p-3 bg-black/20 border border-border-color rounded-lg text-xs flex items-center justify-between gap-3 cursor-pointer hover:border-border-color-focus transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-secondary truncate">{video.name}</h4>
                        <span className="text-[9px] text-muted font-mono">{formatDuration(video.duration)}</span>
                      </div>
                      <div className="gradient-btn px-2 py-0.5 text-[10px] shrink-0">
                        + Adicionar {count > 0 && <span className="bg-white/20 text-white px-1 rounded ml-1">{count}</span>}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Video Preview Modal Overlay */}
      {previewVideoUrl && (
        <div 
          className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setPreviewVideoUrl(null)}
        >
          <div 
            className="glass-panel w-full max-w-4xl p-2 relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setPreviewVideoUrl(null)}
              className="absolute top-4 right-4 h-10 w-10 rounded-full bg-black/60 text-white hover:bg-black/90 flex items-center justify-center z-10 transition-all border border-white/10"
            >
              <X size={20} />
            </button>
            <video 
              src={previewVideoUrl} 
              controls 
              autoPlay 
              className="w-full rounded-lg"
              style={{ maxHeight: '75vh', backgroundColor: '#000' }}
            />
          </div>
        </div>
      )}

    </div>
  );
}
