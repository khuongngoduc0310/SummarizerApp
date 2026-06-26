import { useState, useEffect, useRef, useCallback } from 'react';

export const useWebRTC = (socket, meetingId, displayName, isMuted, isVideoOff, selectedVideoDeviceId, selectedAudioDeviceId) => {
    const [localStream, setLocalStream] = useState(null);
    const [remoteStreams, setRemoteStreams] = useState({});
    const [remoteStatus, setRemoteStatus] = useState({});
    const [isHost, setIsHost] = useState(false);
    const [hostId, setHostId] = useState(null);
    
    const peerConnections = useRef({}); // socketId -> RTCPeerConnection
    const localStreamRef = useRef(null);
    // Include displayName in statusRef for synchronization
    const statusRef = useRef({ isMuted: isMuted, isVideoOff: isVideoOff, displayName: displayName });
    const pendingCandidates = useRef({}); // socketId -> RTCIceCandidate[]

    // 1. Media Track Synchronization (Physical Hardware Toggle & Device Switch)
    useEffect(() => {
        const syncMedia = async () => {
            // Initial load or device switch might happen here
            // But we need to be careful not to re-create stream if just toggling mute
            // Ideally, we handle "device change" separately from "mute/unmute"
            
            // For now, valid logic: 
            // If current stream deviceId != selectedDeviceId, get new stream.
        };
    }, []); 

    // Re-implementing the main effect to handle constraints
    useEffect(() => {
        const updateStream = async () => {
            if (!meetingId) {
                if (localStreamRef.current) {
                    localStreamRef.current.getTracks().forEach(t => t.stop());
                    localStreamRef.current = null;
                    setLocalStream(null);
                }
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
                        
                        // Replace in PCs
                        Object.values(peerConnections.current).forEach(pc => {
                            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                            if (sender) sender.replaceTrack(newTrack);
                            else pc.addTrack(newTrack, localStreamRef.current);
                        });
                        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
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
                        
                        Object.values(peerConnections.current).forEach(pc => {
                            const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
                            if (sender) sender.replaceTrack(newTrack);
                            else pc.addTrack(newTrack, localStreamRef.current);
                        });
                        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
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
                     if (videoTrack && videoTrack.readyState === 'live') videoTrack.stop();
                } else {
                     if (!videoTrack || videoTrack.readyState !== 'live') {
                         // Needs to restart video
                          try {
                            const newStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
                            const newTrack = newStream.getVideoTracks()[0];
                            if (videoTrack) localStreamRef.current.removeTrack(videoTrack);
                            localStreamRef.current.addTrack(newTrack);
                            Object.values(peerConnections.current).forEach(pc => {
                                const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                                if (sender) sender.replaceTrack(newTrack);
                                else pc.addTrack(newTrack, localStreamRef.current);
                            });
                             setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
                          } catch (e) { console.error(e) }
                     } else {
                         videoTrack.enabled = true;
                     }
                }
                
                // Sync status
                if (socket && meetingId) {
                    socket.emit('status-change', { meetingId, status: { isMuted, isVideoOff, displayName } });
                }

                return;
            }

            // Initial Stream Creation
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: audioConstraints, 
                    video: videoConstraints 
                });
                
                localStreamRef.current = stream;
                setLocalStream(stream);

                 if (isVideoOff) stream.getVideoTracks().forEach(t => t.stop());
                 if (isMuted) stream.getAudioTracks().forEach(t => t.enabled = false);

                 Object.values(peerConnections.current).forEach(pc => {
                     stream.getTracks().forEach(track => pc.addTrack(track, stream));
                 });

            } catch (err) {
                console.error("Error accessing media devices:", err);
            }
        };

        updateStream();

    }, [meetingId, isMuted, isVideoOff, selectedVideoDeviceId, selectedAudioDeviceId, displayName, socket]); // Consolidated dependency array

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

            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => {
                    pc.addTrack(track, localStreamRef.current);
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
        
        Object.values(peerConnections.current).forEach(pc => pc.close());
        peerConnections.current = {};
        pendingCandidates.current = {};
        
        setLocalStream(null);
        setRemoteStreams({});
        setRemoteStatus({});
        setIsHost(false);
        setHostId(null);
        statusRef.current = { isMuted: true, isVideoOff: true, displayName: '' };
    }, [socket]);

    return {
        localStream,
        remoteStreams,
        remoteStatus,
        isHost,
        hostId,
        leave
    };
};
