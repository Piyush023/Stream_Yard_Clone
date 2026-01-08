'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const Home = () => {
  const [camFeed, setCamFeed] = useState<MediaStream | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const myVideo = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Initialize socket connection once
  useEffect(() => {
    const socket = io('http://localhost:3000');

    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  // Initialize camera feed
  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        setCamFeed(stream);
        if (myVideo.current) {
          myVideo.current.srcObject = stream;
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
      }
    };

    initCamera();

    // Cleanup camera on unmount
    return () => {
      if (camFeed) {
        camFeed.getTracks().forEach((track) => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startStreaming = useCallback(() => {
    if (!camFeed || !socketRef.current) {
      console.error('Camera feed or socket not ready');
      return;
    }

    const mediaRecorder = new MediaRecorder(camFeed, {
      audioBitsPerSecond: 128000,
      videoBitsPerSecond: 250000,
    });

    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0 && socketRef.current?.connected) {
        console.log('Sending media data:', ev.data.size, 'bytes');
        socketRef.current.emit('binaryStream', ev.data);
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
    };

    mediaRecorder.onstop = () => {
      console.log('MediaRecorder stopped');
    };

    mediaRecorder.start(25); // Send data every 25ms
    mediaRecorderRef.current = mediaRecorder;
    setIsStreaming(true);
    console.log('Streaming started');
  }, [camFeed]);

  const stopStreaming = useCallback(() => {
    // Stop the media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    // Notify server to stop streaming
    if (socketRef.current?.connected) {
      socketRef.current.emit('stopStream');
    }

    setIsStreaming(false);
    console.log('Streaming stopped');
  }, []);

  return (
    <div>
      <h1>StreamYard Clone</h1>
      <video
        style={{ width: '500px', height: '200px', borderWidth: '1px', borderColor: 'red' }}
        autoPlay
        ref={myVideo}
        id="user-media"
        muted
      />
      <div style={{ marginTop: '10px' }}>
        <button onClick={startStreaming} disabled={isStreaming || !camFeed}>
          Start
        </button>
        <button onClick={stopStreaming} disabled={!isStreaming} style={{ marginLeft: '10px' }}>
          End
        </button>
      </div>
    </div>
  );
};

export default Home;
