import { useState, useEffect, useRef, useCallback } from 'react';
import {
    BACKGROUND_BLUR_STATUS,
    BackgroundBlurProcessor
} from '../utils/backgroundBlur';
import { replacePeerVideoTrack } from '../utils/videoTrackSender';

export const useWebRTC = (socket, meetingId, displayName, isMuted, isVideoOff, selectedVideoDeviceId, selectedAudioDeviceId, backgroundBlurEnabled) => {
    const [localStream, setLocalStream] = useState(null);
    const [remoteStreams, setRemoteStreams] = useState({});
    const [remoteStatus, setRemoteStatus] = useState({});
    const [isHost, setIsHost] = useState(false);
    const [hostId, setHostId] = useState(null);
    const [backgroundBlurStatus, setBackgroundBlurStatus] = useState(BACKGROUND_BLUR_STATUS.OFF);
    
    const peerConnections = useRef({}); // socketId -> RTCPeerConnection
    const localStreamRef = useRef(null);
    const outgoingStreamRef = useRef(null);
    const backgroundBlurProcessorRef = useRef(null);
    const backgroundBlurRequestRef = useRef(0);
    const backgroundBlurUnavailableRef = useRef(false);
    const lastRawVideoTrackRef = useRef(null);
    const syncOutgoingStreamRef = useRef(null);
    const videoSendersRef = useRef({});
    // Include displayName in statusRef for synchronization
    const statusRef = useRef({ isMuted: isMuted, isVideoOff: isVideoOff, displayName: displayName });
    const pendingCandidates = useRef({}); // socketId -> RTCIceCandidate[]

    const replaceOutgoingVideoTrack = useCallback(async (videoTrack, stream) => {
        await Promise.all(Object.entries(peerConnections.current).map(async ([socketId, pc]) => {
            const sender = await replacePeerVideoTrack(pc, videoSendersRef.current[socketId], videoTrack, stream);
            if (sender) videoSendersRef.current[socketId] = sender;
        }));
    }, []);

    const syncOutgoingStream = useCallback(async () => {
        const rawStream = localStreamRef.current;
        const requestId = ++backgroundBlurRequestRef.current;
        const previousProcessor = backgroundBlurProcessorRef.current;
        if (!backgroundBlurEnabled) backgroundBlurUnavailableRef.current = false;

        if (!rawStream) {
            outgoingStreamRef.current = null;
            setLocalStream(null);
            setBackgroundBlurStatus(BACKGROUND_BLUR_STATUS.OFF);
            previousProcessor?.dispose();
            backgroundBlurProcessorRef.current = null;
            return;
        }

        const rawVideoTrack = rawStream.getVideoTracks().find((track) => track.readyState === 'live') || null;
        const rawVideoChanged = lastRawVideoTrackRef.current !== rawVideoTrack;
        if (rawVideoChanged) {
            lastRawVideoTrackRef.current = rawVideoTrack;
            backgroundBlurUnavailableRef.current = false;
        }
        let videoTrack = rawVideoTrack;

        if (backgroundBlurEnabled && rawVideoTrack && !backgroundBlurUnavailableRef.current && previousProcessor && !rawVideoChanged) {
            videoTrack = previousProcessor.outputStream?.getVideoTracks()[0] || rawVideoTrack;
        } else if (backgroundBlurEnabled && rawVideoTrack && !backgroundBlurUnavailableRef.current) {
            const processor = new BackgroundBlurProcessor({
                onStatus: (status) => {
                    if (backgroundBlurProcessorRef.current !== processor && backgroundBlurRequestRef.current !== requestId) return;
                    setBackgroundBlurStatus(status);
                },
                onFailure: () => {
                    if (backgroundBlurProcessorRef.current !== processor && backgroundBlurRequestRef.current !== requestId) return;
                    backgroundBlurUnavailableRef.current = true;
                    window.setTimeout(() => syncOutgoingStreamRef.current?.(), 0);
                }
            });

            try {
                const processedStream = await processor.start(new MediaStream([rawVideoTrack]));
                if (backgroundBlurRequestRef.current !== requestId) {
                    processor.dispose();
                    return;
                }
                videoTrack = processedStream.getVideoTracks()[0] || rawVideoTrack;
                backgroundBlurProcessorRef.current = processor;
            } catch (error) {
                processor.dispose();
                backgroundBlurUnavailableRef.current = true;
                console.warn('Background blur is unavailable:', error);
                if (backgroundBlurRequestRef.current === requestId) {
                    setBackgroundBlurStatus(BACKGROUND_BLUR_STATUS.UNAVAILABLE);
                }
            }
        } else if (backgroundBlurEnabled && backgroundBlurUnavailableRef.current) {
            setBackgroundBlurStatus(BACKGROUND_BLUR_STATUS.UNAVAILABLE);
        } else {
            setBackgroundBlurStatus(BACKGROUND_BLUR_STATUS.OFF);
        }

        if (backgroundBlurRequestRef.current !== requestId) return;

        const outgoingStream = new MediaStream([
            ...rawStream.getAudioTracks(),
            ...(videoTrack ? [videoTrack] : [])
        ]);
        await replaceOutgoingVideoTrack(videoTrack, outgoingStream);
        if (backgroundBlurRequestRef.current !== requestId) return;
        outgoingStreamRef.current = outgoingStream;
        setLocalStream(outgoingStream);
        if (videoTrack === rawVideoTrack) {
            previousProcessor?.dispose();
            if (backgroundBlurProcessorRef.current === previousProcessor) backgroundBlurProcessorRef.current = null;
        } else if (previousProcessor && previousProcessor !== backgroundBlurProcessorRef.current) {
            previousProcessor.dispose();
        }
    }, [backgroundBlurEnabled, replaceOutgoingVideoTrack]);

    useEffect(() => {
        syncOutgoingStreamRef.current = syncOutgoingStream;
        return () => {
            syncOutgoingStreamRef.current = null;
        };
    }, [syncOutgoingStream]);

    // Media stream effect handles physical hardware toggles and device switches.
    useEffect(() => {
        const updateStream = async () => {
            if (!meetingId) {
                if (localStreamRef.current) {
                    localStreamRef.current.getTracks().forEach(t => t.stop());
                    localStreamRef.current = null;
                }
                syncOutgoingStream();
                return;
            }

            // Define constraints based on selection. Enable browser/Electron Chromium
            // audio processing before the stream reaches WebRTC and STT.
            const baseAudioConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            };
            const audioConstraints = selectedAudioDeviceId
                ? { ...baseAudioConstraints, deviceId: { exact: selectedAudioDeviceId } }
                : baseAudioConstraints;
            const videoConstraints = selectedVideoDeviceId ? { deviceId: { exact: selectedVideoDeviceId } } : true;

            // If we already have a stream, check if we need to switch tracks
            if (localStreamRef.current) {
                const currentVideoTrack = localStreamRef.current.getVideoTracks()[0];
                const currentAudioTrack = localStreamRef.current.getAudioTracks()[0];

                const currentVideoDevice = currentVideoTrack?.getSettings().deviceId;
                const currentAudioDevice = currentAudioTrack?.getSettings().deviceId;

                // Check Video Change
                if (!isVideoOff && selectedVideoDeviceId && currentVideoDevice !== selectedVideoDeviceId) {
                    console.log("Switching Video Device to:", selectedVideoDeviceId);
                    try {
                        const newStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
                        const newTrack = newStream.getVideoTracks()[0];
                        
                        if (currentVideoTrack) {
                            localStreamRef.current.removeTrack(currentVideoTrack);
                            currentVideoTrack.stop();
                        }
                        localStreamRef.current.addTrack(newTrack);
                        
                    } catch (e) {
                         console.error("Failed to switch video:", e);
                    }
                }

                // Check Audio Change
                if (!isMuted && selectedAudioDeviceId && currentAudioDevice !== selectedAudioDeviceId) {
                     console.log("Switching Audio Device to:", selectedAudioDeviceId);
                     try {
                        const newStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                        const newTrack = newStream.getAudioTracks()[0];
                        
                        if (currentAudioTrack) {
                            localStreamRef.current.removeTrack(currentAudioTrack);
                            currentAudioTrack.stop();
                        }
                        localStreamRef.current.addTrack(newTrack);
                        Object.values(peerConnections.current).forEach((pc) => {
                            const sender = pc.getSenders().find((candidate) => candidate.track?.kind === 'audio');
                            if (sender) sender.replaceTrack(newTrack).catch((error) => console.warn('Failed to replace audio track:', error));
                            else pc.addTrack(newTrack, localStreamRef.current);
                        });
                     } catch (e) {
                         console.error("Failed to switch audio:", e);
                     }
                }

                // Handle Mute/Video Off logic (existing logic)
                localStreamRef.current.getAudioTracks().forEach(track => {
                    track.enabled = !isMuted;
                });
                
                const videoTrack = localStreamRef.current.getVideoTracks()[0];
                if (isVideoOff) {
                     if (videoTrack && videoTrack.readyState === 'live') {
                         videoTrack.stop();
                         localStreamRef.current.removeTrack(videoTrack);
                     }
                } else {
                     if (!videoTrack || videoTrack.readyState !== 'live') {
                         // Needs to restart video
                          try {
                            const newStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
                            const newTrack = newStream.getVideoTracks()[0];
                            if (videoTrack) localStreamRef.current.removeTrack(videoTrack);
                            localStreamRef.current.addTrack(newTrack);
                           } catch (e) { console.error(e) }
                     } else {
                         videoTrack.enabled = true;
                     }
                }
                
                // Sync status
                if (socket && meetingId) {
                    socket.emit('status-change', { meetingId, status: { isMuted, isVideoOff, displayName } });
                }

                await syncOutgoingStream();
                return;
            }

            // Initial Stream Creation
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: audioConstraints, 
                    video: videoConstraints 
                });
                
                localStreamRef.current = stream;

                 if (isVideoOff) {
                     stream.getVideoTracks().forEach((track) => {
                         track.stop();
                         stream.removeTrack(track);
                     });
                 }
                 if (isMuted) stream.getAudioTracks().forEach(t => t.enabled = false);
                 await syncOutgoingStream();

            } catch (err) {
                console.error("Error accessing media devices:", err);
            }
        };

        updateStream();

    }, [meetingId, isMuted, isVideoOff, selectedVideoDeviceId, selectedAudioDeviceId, displayName, socket, syncOutgoingStream]); // Consolidated dependency array

    // 2. Signaling Setup
    useEffect(() => {
        if (!socket || !meetingId) return;

        const createPC = (socketId, isInitiator) => {
            if (peerConnections.current[socketId]) return peerConnections.current[socketId];

            console.log(`Creating PeerConnection for: ${socketId} (Initiator: ${isInitiator})`);

            const pc = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                ]
            });

            // Handle track signaling updates
            pc.onnegotiationneeded = async () => {
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    socket.emit('signal', { to: socketId, signal: pc.localDescription });
                } catch (err) {
                    console.error("Negotiation error:", err);
                }
            };

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socket.emit('signal', { to: socketId, signal: { type: 'candidate', candidate: e.candidate } });
                }
            };

            pc.ontrack = (e) => {
                console.log(`Remote track received from: ${socketId}`);
                setRemoteStreams(prev => ({ ...prev, [socketId]: e.streams[0] }));
            };

            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                    cleanupUser(socketId);
                }
            };

            if (outgoingStreamRef.current) {
                outgoingStreamRef.current.getTracks().forEach(track => {
                    const sender = pc.addTrack(track, outgoingStreamRef.current);
                    if (track.kind === 'video') videoSendersRef.current[socketId] = sender;
                });
            }

            peerConnections.current[socketId] = pc;
            return pc;
        };

        const cleanupUser = (socketId) => {
            console.log(`Cleaning up user: ${socketId}`);
            
            if (peerConnections.current[socketId]) {
                peerConnections.current[socketId].close();
                delete peerConnections.current[socketId];
                delete videoSendersRef.current[socketId];
            }
            
            if (pendingCandidates.current[socketId]) {
                delete pendingCandidates.current[socketId];
            }

            setRemoteStreams(prev => {
                const n = { ...prev };
                delete n[socketId];
                return n;
            });

            setRemoteStatus(prev => {
                const n = { ...prev };
                delete n[socketId];
                return n;
            });
        };

        const handleSignal = async (data) => {
            const { from: socketId, signal } = data;
            let pc = peerConnections.current[socketId] || createPC(socketId, false);

            try {
                if (signal.type === 'offer') {
                    await pc.setRemoteDescription(new RTCSessionDescription(signal));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    socket.emit('signal', { to: socketId, signal: pc.localDescription });
                    
                    if (pendingCandidates.current[socketId]) {
                        for (const candidate of pendingCandidates.current[socketId]) {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate));
                        }
                        delete pendingCandidates.current[socketId];
                    }
                } else if (signal.type === 'answer') {
                    await pc.setRemoteDescription(new RTCSessionDescription(signal));
                    
                    if (pendingCandidates.current[socketId]) {
                        for (const candidate of pendingCandidates.current[socketId]) {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate));
                        }
                        delete pendingCandidates.current[socketId];
                    }
                } else if (signal.type === 'candidate') {
                    if (pc.remoteDescription && pc.remoteDescription.type) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
                        } catch (e) {
                            console.warn("Error adding ICE candidate:", e);
                        }
                    } else {
                        if (!pendingCandidates.current[socketId]) pendingCandidates.current[socketId] = [];
                        pendingCandidates.current[socketId].push(signal.candidate);
                    }
                }
            } catch (err) {
                console.error("Signaling error:", err);
            }
        };

        const handleUserJoined = (data) => {
            console.log("User joined meeting:", data.socketId, data.displayName);
            createPC(data.socketId, true);
            // Store the status and userId initially if available
            setRemoteStatus(prev => ({
                ...prev,
                [data.socketId]: { 
                    ...(prev[data.socketId] || {}), 
                    ...(data.status || {}),
                    userId: data.userId, // Map socketId to backend userId
                    displayName: data.displayName || data.status?.displayName || 'Guest'
                }
            }));
            // Send our current status (including our name) to the new user
            socket.emit('status-change', { meetingId, status: statusRef.current });
        };

        const handleJoinedSuccessfully = (data) => {
            if (data.existingParticipants) {
                console.log("Initial participants:", data.existingParticipants);
                const initialStatus = {};
                data.existingParticipants.forEach(p => {
                    initialStatus[p.socketId] = {
                        ...p.status,
                        userId: p.userId
                    };
                });
                setRemoteStatus(prev => ({ ...prev, ...initialStatus }));
            }
        };

        const handleHostInfo = (data) => {
            setHostId(data.hostId);
            setIsHost(socket.id === data.hostId);
        };

        const handleUserLeft = (data) => {
            cleanupUser(data.socketId);
        };

        const handleStatusUpdate = (data) => {
            const { from, status } = data;
            setRemoteStatus(prev => ({
                ...prev,
                [from]: { ...prev[from], ...status }
            }));
        };

        socket.on('signal', handleSignal);
        socket.on('user-joined', handleUserJoined);
        socket.on('joined-successfully', handleJoinedSuccessfully);
        socket.on('host-info', handleHostInfo);
        socket.on('user-left', handleUserLeft);
        socket.on('status-change', handleStatusUpdate);

        return () => {
            socket.off('signal', handleSignal);
            socket.off('user-joined', handleUserJoined);
            socket.off('joined-successfully', handleJoinedSuccessfully);
            socket.off('host-info', handleHostInfo);
            socket.off('user-left', handleUserLeft);
            socket.off('status-change', handleStatusUpdate);
        };
    }, [socket, meetingId]);

    const leave = useCallback(() => {
        if (socket) {
            socket.emit('leave-meeting');
        }
        
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }
        backgroundBlurRequestRef.current += 1;
        backgroundBlurProcessorRef.current?.dispose();
        backgroundBlurProcessorRef.current = null;
        outgoingStreamRef.current = null;
        
        Object.values(peerConnections.current).forEach(pc => pc.close());
        peerConnections.current = {};
        videoSendersRef.current = {};
        pendingCandidates.current = {};
        
        setLocalStream(null);
        setRemoteStreams({});
        setRemoteStatus({});
        setIsHost(false);
        setHostId(null);
        setBackgroundBlurStatus(BACKGROUND_BLUR_STATUS.OFF);
        statusRef.current = { isMuted: true, isVideoOff: true, displayName: '' };
    }, [socket]);

    return {
        localStream,
        remoteStreams,
        remoteStatus,
        isHost,
        hostId,
        backgroundBlurStatus,
        leave
    };
};
