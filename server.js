import express from 'express';
import { createServer } from 'http';
import next from 'next';
import { Server as SocketIO } from 'socket.io';
import { spawn } from 'child_process';

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = process.env.PORT || 3000;
const hostname = 'localhost';

// FFmpeg options for streaming - Bitrate, Format, AudioRate
const getFfmpegOptions = (rtmpUrl) => [
  '-i',
  '-',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-tune',
  'zerolatency',
  '-r',
  `${25}`,
  '-g',
  `${25 * 2}`,
  '-keyint_min',
  '25',
  '-crf',
  '25',
  '-pix_fmt',
  'yuv420p',
  '-sc_threshold',
  '0',
  '-profile:v',
  'main',
  '-level',
  '3.1',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  '-ar',
  `${128000 / 4}`,
  '-f',
  'flv',
  rtmpUrl,
];

// Helper function to spawn FFmpeg process
const spawnFfmpegProcess = (rtmpUrl) => {
  const options = getFfmpegOptions(rtmpUrl);
  console.log('Spawning FFmpeg with RTMP URL:', rtmpUrl);
  const ffmpegProcess = spawn('ffmpeg', options);

  // Collect stderr for better error diagnostics
  let stderrBuffer = '';

  ffmpegProcess.stdout.on('data', (data) => {
    console.log(`ffmpeg stdout: ${data}`);
  });

  ffmpegProcess.stderr.on('data', (data) => {
    const message = data.toString();
    stderrBuffer += message;
    // Only log important FFmpeg messages (errors, warnings, connection status)
    if (
      message.includes('error') ||
      message.includes('Error') ||
      message.includes('Connection') ||
      message.includes('failed')
    ) {
      console.error(`ffmpeg stderr: ${message}`);
    }
  });

  ffmpegProcess.on('close', (code) => {
    if (code !== 0) {
      console.error(`FFmpeg exited with code ${code}. Last stderr:`, stderrBuffer.slice(-500)); // Last 500 chars of stderr
    }
  });

  return ffmpegProcess;
};

app.prepare().then(() => {
  const expressApp = express();
  const server = createServer(expressApp);
  const io = new SocketIO(server);

  // Store active streaming sessions per socket
  const activeSessions = new Map();

  // Default RTMP URL - make it configurable per session
  const defaultRtmpUrl = 'rtmp://a.rtmp.youtube.com/live2/8p3h-jpbp-3cuv-ptu8-au1y';

  rtmp: io.on('connection', (socket) => {
    console.log('Socket Connected', socket.id);

    let ffmpegProcess = null;
    let isStreamActive = false;

    // Helper to cleanup FFmpeg process
    const cleanupFfmpeg = () => {
      isStreamActive = false;
      if (ffmpegProcess) {
        activeSessions.delete(socket.id);
        ffmpegProcess = null;
      }
    };

    // Start streaming when client connects and sends first data
    socket.on('binaryStream', (stream) => {
      // Spawn FFmpeg process on first data if not already running
      if (!ffmpegProcess && !isStreamActive) {
        console.log('Starting FFmpeg process for socket:', socket.id);
        ffmpegProcess = spawnFfmpegProcess(defaultRtmpUrl);
        isStreamActive = true;

        // Stop writing immediately on stdin error (EPIPE)
        ffmpegProcess.stdin.on('error', (err) => {
          console.error(`FFmpeg stdin error for ${socket.id}:`, err.message);
          isStreamActive = false; // Stop writes immediately
        });

        // Handle FFmpeg process close
        ffmpegProcess.on('close', (code) => {
          console.log(`FFmpeg closed for socket ${socket.id} with code ${code}`);
          if (code !== 0) {
            socket.emit('streamError', {
              message: 'Stream ended unexpectedly',
              code,
            });
          }
          cleanupFfmpeg();
        });

        ffmpegProcess.on('error', (err) => {
          console.error(`FFmpeg process error for ${socket.id}:`, err.message);
          cleanupFfmpeg();
        });

        activeSessions.set(socket.id, ffmpegProcess);
      }

      // Only write if stream is active and stdin is writable
      if (isStreamActive && ffmpegProcess && ffmpegProcess.stdin && !ffmpegProcess.stdin.destroyed) {
        ffmpegProcess.stdin.write(stream, (err) => {
          if (err) {
            // Stop further writes on any write error
            isStreamActive = false;
            console.error(`Write error for socket ${socket.id}:`, err.message);
          }
        });
      }
    });

    // Handle stop streaming request
    socket.on('stopStream', () => {
      console.log('Stop stream requested for socket:', socket.id);
      if (ffmpegProcess && ffmpegProcess.stdin.writable) {
        ffmpegProcess.stdin.end();
      }
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGINT');
      }
      isStreamActive = false;
      ffmpegProcess = null;
      activeSessions.delete(socket.id);
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      console.log('Socket Disconnected', socket.id);
      if (ffmpegProcess) {
        if (ffmpegProcess.stdin.writable) {
          ffmpegProcess.stdin.end();
        }
        ffmpegProcess.kill('SIGINT');
      }
      activeSessions.delete(socket.id);
    });
  });

  expressApp.get('*', (req, res) => {
    return handle(req, res);
  });

  server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
