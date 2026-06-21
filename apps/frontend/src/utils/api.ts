export function getApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }
  if (typeof window !== 'undefined') {
    // Dynamically connect to port 5000 on the same host
    return `${window.location.protocol}//${window.location.hostname}:5000`;
  }
  return 'http://localhost:5000';
}

export function getWsUrl(): string {
  const apiUrl = getApiUrl();
  const url = new URL(apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  let wsUrl = url.toString();
  if (wsUrl.endsWith('/')) {
    wsUrl = wsUrl.slice(0, -1);
  }
  return wsUrl;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const rawUrl = `${getApiUrl()}/${path}`;
  const url = rawUrl.replace(/([^:]\/)\/+/g, '$1');

  const headers = {
    ...options.headers as any
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = 'Request failed';
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error || errorMessage;
    } catch (e) {}
    throw new Error(errorMessage);
  }

  // Handle empty or JSON responses
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

// Upload file using XMLHttpRequest to track progress in real-time
export function apiUpload(
  path: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const rawUrl = `${getApiUrl()}/${path}`;
    const url = rawUrl.replace(/([^:]\/)\/+/g, '$1');
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

    xhr.open('POST', url, true);
    
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        onProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (e) {
          resolve(xhr.responseText);
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || `Upload failed (Status ${xhr.status})`));
        } catch (e) {
          reject(new Error(`Upload failed (Status ${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during upload'));
    };

    const formData = new FormData();
    formData.append('video', file);
    xhr.send(formData);
  });
}
