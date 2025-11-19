import { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Pause, Play, Share2, Clock, User, MessageSquare, LogOut, AlertCircle, PhoneIncoming, X, Check } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import "amazon-connect-streams"
import { toast } from 'sonner';

declare global
{
    interface Window
    {
        connect: {
            core: {
                initCCP: (container: HTMLElement, config: any) => void;
            };
            agent: (callback: (agent: any) => void) => void;
            contact: (callback: (contact: any) => void) => void;
            Endpoint: {
                byPhoneNumber: (phoneNumber: string) => any;
                byQueueARN: (queueARN: string) => any;
            };
            ConnectionType?: {
                AGENT: string;
                INBOUND: string;
                OUTBOUND: string;
                MONITORING: string;
            };
        };
    }
}

const P3FusionCCP = () =>
{
    const [agentStatus, setAgentStatus] = useState<string>('Offline');
    const [callStatus, setCallStatus] = useState<'idle' | 'active' | 'wrapup' | "AfterCallWork">('idle');
    const [callTimer, setCallTimer] = useState<number>(0);
    const [isMuted, setIsMuted] = useState<boolean>(false);
    const [isOnHold, setIsOnHold] = useState<boolean>(false);
    const [callNotes, setCallNotes] = useState<string>('');
    const [phoneNumber, setPhoneNumber] = useState<string>('');
    const [showDialer, setShowDialer] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [agentName, setAgentName] = useState<string>('');
    const [incomingCall, setIncomingCall] = useState<boolean>(false);

    const [contactDetails, setContactDetails] = useState({
        contactId: '',
        customerName: '',
        customerPhone: '',
        reason: '',
        queueName: ''
    });

    const ccpContainerRef = useRef<HTMLDivElement | null>(null);
    const agentRef = useRef<any>(null);
    const contactRef = useRef<any>(null);
    const timerRef = useRef<any | null>(null);
    const callStartTime = useRef<number | null>(null);
    const callSummarySavedRef = useRef<boolean>(false);
    const isProcessingCallEndRef = useRef<boolean>(false);
    const callDataSnapshot = useRef<any>(null);
    const agentNameRef = useRef<string>('')
    const notesRef = useRef<string>('No notes')
    // Initialize Amazon Connect CCP
    useEffect(() =>
    {
        const initCCP = async () =>
        {
            try
            {
                if (!window.connect)
                {
                    setError('Amazon Connect Streams library not loaded. Please include: <script src="https://your-instance.my.connect.aws/connect/streams"></script>');
                    return;
                }

                if (!ccpContainerRef.current) return;

                const ccpUrl = 'https://p3fusion-learning.my.connect.aws/ccp-v2';

                window.connect.core.initCCP(ccpContainerRef.current, {
                    ccpUrl: ccpUrl,
                    loginPopup: true,
                    loginPopupAutoClose: true,
                    loginUrl: 'https://p3fusion-learning.my.connect.aws/connect/login',
                    region: 'us-east-1',
                    softphone: {
                        allowFramedSoftphone: true,
                        disableRingtone: false
                    }
                });

                window.connect.agent((agent: any) =>
                {
                    agentRef.current = agent;
                    setAgentName(agent.getName());
                    agentNameRef.current = agent.getName()
                    const currentState = agent.getState();
                    setAgentStatus(currentState.name || currentState);

                    agent.onStateChange((agentStateChange: any) =>
                    {
                        const newState = agentStateChange.newState;
                        setAgentStatus(newState.name || newState);
                    });

                    agent.onRefresh(() =>
                    {
                        console.log('Agent refreshed');
                    });
                });

                window.connect.contact((contact: any) =>
                {
                    console.log('New contact detected:', contact.getContactId());
                    contactRef.current = contact;

                    // Reset the saved flag for new contact
                    callSummarySavedRef.current = false;
                    isProcessingCallEndRef.current = false;

                    contact.onConnecting(() =>
                    {
                        console.log('Contact connecting');
                        callSummarySavedRef.current = false; // Reset for new contact
                        isProcessingCallEndRef.current = false;
                        const isInbound = contact.isInbound();

                        if (isInbound)
                        {
                            setIncomingCall(true);
                            const attributes = contact.getAttributes();
                            const connection = contact.getInitialConnection();
                            const endpoint = connection.getEndpoint();

                            const details = {
                                contactId: contact.getContactId(),
                                customerName: attributes.customerName?.value || 'Unknown',
                                customerPhone: endpoint.phoneNumber || 'Unknown',
                                reason: attributes.reason?.value || 'Incoming Call',
                                queueName: contact.getQueue()?.name || 'General'
                            };

                            setContactDetails(details);
                            callDataSnapshot.current = details; // Store snapshot
                        }
                    });

                    contact.onAccepted(() =>
                    {
                        console.log('Contact accepted');
                        setIncomingCall(false);
                        setCallStatus('active');
                        callStartTime.current = Date.now();
                        setIsMuted(false);
                        setIsOnHold(false);

                        const attributes = contact.getAttributes();
                        const connection = contact.getInitialConnection();
                        const endpoint = connection.getEndpoint();

                        const details = {
                            contactId: contact.getContactId(),
                            customerName: attributes.customerName?.value || 'Unknown',
                            customerPhone: endpoint.phoneNumber || 'Unknown',
                            reason: attributes.reason?.value || 'Connected',
                            queueName: contact.getQueue()?.name || 'General'
                        };

                        setContactDetails(details);
                        callDataSnapshot.current = details; // Store snapshot
                    });

                    contact.onConnected(() =>
                    {
                        console.log('Contact connected');
                        setCallStatus('active');
                        if (!callStartTime.current)
                        {
                            callStartTime.current = Date.now();
                        }
                    });

                    // FIXED: Single point of call end handling
                    contact.onEnded(() =>
                    {
                        console.log('Contact ended - onEnded event');
                        handleCallEnd();
                    });

                    contact.onMissed(() =>
                    {
                        console.log('Contact missed');
                        setIncomingCall(false);
                        setError('Call was missed');
                        setTimeout(() => setError(''), 3000);
                    });

                    contact.onACW(() =>
                    {
                        console.log('Contact in ACW');
                        setCallStatus('wrapup');
                    });
                });
                setError('');
            } catch (err)
            {
                console.error('CCP Initialization Error:', err);
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                setError(`Failed to initialize CCP: ${errorMessage}`);
            }
        };

        initCCP();

        return () =>
        {
            if (timerRef.current)
            {
                clearInterval(timerRef.current);
            }
        };
    }, []);

    // Call timer
    useEffect(() =>
    {
        if (callStatus === 'active' && callStartTime.current)
        {
            timerRef.current = setInterval(() =>
            {
                if (callStartTime.current)
                {
                    const elapsed = Math.floor((Date.now() - callStartTime.current) / 1000);
                    setCallTimer(elapsed);
                }
            }, 1000);
        } else
        {
            if (timerRef.current)
            {
                clearInterval(timerRef.current);
            }
            if (callStatus === 'idle')
            {
                setCallTimer(0);
                callStartTime.current = null;
            }
        }

        return () =>
        {
            if (timerRef.current)
            {
                clearInterval(timerRef.current);
            }
        };
    }, [callStatus]);

    const formatTime = (seconds: number): string =>
    {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleStatusChange = (status: string) =>
    {
        if (!agentRef.current) return;

        try
        {
            const agent = agentRef.current;
            const agentStates = agent.getAgentStates();
            const targetState = agentStates.find((state: any) => state.name === status);

            if (targetState)
            {
                agent.setState(targetState, {
                    success: () =>
                    {
                        console.log('Status changed to:', status);
                        setAgentStatus(status);
                    },
                    failure: (err: any) =>
                    {
                        console.error('Failed to change status:', err);
                        setError('Failed to change status');
                    }
                });
            }
        } catch (err)
        {
            console.error('Error changing status:', err);
            setError('Error changing agent status');
        }
    };

    const handleDialerClick = async (digit: string) =>
    {
        if (agentStatus == "CallingCustomer")
        {
            try
            {
                const connection = contactRef.current.getInitialConnection();

                if (!connection)
                {
                    console.error('No active connection');
                    setError('No active connection to send digit');
                    return;
                }

                connection.sendDigits(digit, {
                    success: () =>
                    {
                        console.log(`✓ Digit sent: ${digit}`);
                    },
                    failure: (err: any) =>
                    {
                        console.error('Failed to send digit:', err);
                        setError(`Failed to send digit: ${digit}`);
                    }
                });
            } catch (err)
            {
                console.error('Error sending digit:', err);
                const errorMsg = err instanceof Error ? err.message : 'Unknown error';
                setError(`Error sending digit: ${errorMsg}`);
            }
        }

        setPhoneNumber(prev => prev + digit);
    };

    const handleAcceptCall = () =>
    {
        if (!contactRef.current) return;

        try
        {
            contactRef.current.accept({
                success: () =>
                {
                    console.log('Call accepted');
                    setIncomingCall(false);
                },
                failure: (err: any) =>
                {
                    console.error('Failed to accept call:', err);
                    setError('Failed to accept call');
                }
            });
        } catch (err)
        {
            console.error('Error accepting call:', err);
            setError('Error accepting call');
        }
    };

    const handleRejectCall = () =>
    {
        if (!contactRef.current) return;

        try
        {
            contactRef.current.reject({
                success: () =>
                {
                    console.log('Call rejected');
                    setIncomingCall(false);
                    setContactDetails({
                        contactId: '',
                        customerName: '',
                        customerPhone: '',
                        reason: '',
                        queueName: ''
                    });
                },
                failure: (err: any) =>
                {
                    console.error('Failed to reject call:', err);
                    setError('Failed to reject call');
                }
            });
        } catch (err)
        {
            console.error('Error rejecting call:', err);
            setError('Error rejecting call');
        }
    };

    const handleCall = () =>
    {
        if (!phoneNumber || !agentRef.current) return;

        try
        {
            const endpoint = window.connect.Endpoint.byPhoneNumber(phoneNumber);

            agentRef.current.connect(endpoint, {
                success: () =>
                {
                    console.log('Outbound call initiated');
                    setShowDialer(false);
                    setPhoneNumber('');
                },
                failure: (err: any) =>
                {
                    console.error('Failed to make call:', err);
                    setError('Failed to make outbound call');
                }
            });
        } catch (err)
        {
            console.error('Error making call:', err);
            setError('Error initiating call');
        }
    };

    const handleEndCall = () =>
    {
        if (!contactRef.current) return;

        try
        {
            const connection = contactRef.current.getInitialConnection();
            connection.destroy({
                success: () =>
                {
                    console.log('Call ended successfully');
                    connect.contact((contact) =>
                    {
                        console.log(contact.getStatus())
                        toast.info(<pre>{JSON.stringify(contact.getStatus(), null, 2)}</pre>)
                    })
                },
                failure: (err: any) =>
                {
                    console.error('Failed to end call:', err);
                    setError('Failed to end call');
                }
            });
        } catch (err)
        {
            console.error('Error ending call:', err);
            setError('Error ending call');
        }
    };

    const handleCallEnd = async () =>
    {
        // Prevent duplicate processing
        if (isProcessingCallEndRef.current || callSummarySavedRef.current)
        {
            console.log('Call end already being processed, skipping...');
            return;
        }

        isProcessingCallEndRef.current = true;
        console.log('Processing call end...');

        // Calculate final call duration BEFORE any state changes
        const finalDuration = callStartTime.current
            ? Math.floor((Date.now() - callStartTime.current) / 1000)
            : callTimer;

        // Use snapshot data if available, otherwise use current state
        const dataToUse = callDataSnapshot.current || contactDetails;

        toast.success(notesRef.current)

        const callSummary = {
            contactId: callDataSnapshot.current.contactId || contactDetails.contactId,
            agentName: agentNameRef.current,
            customerName: dataToUse.customerName,
            queueName: dataToUse.queueName,
            callDuration: finalDuration,
            customerPhone: dataToUse.customerPhone,
            callNotes: notesRef.current,
            timestamp: new Date().toISOString()
        };

        console.log('Call summary captured:', callSummary);

        if (!callSummary.contactId)
        {
            console.log('No contact ID, skipping save');
            isProcessingCallEndRef.current = false;
            resetCallState();
            return;
        }

        // Mark as saved before API call to prevent race conditions
        callSummarySavedRef.current = true;

        try
        {
            console.log('Sending call summary to API...');
            const response = await fetch('http://localhost:5000/save-call-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(callSummary)
            });

            if (response.ok)
            {
                console.log('✓ Call summary saved successfully');
                alert('Call Summary Saved:\n' + JSON.stringify(callSummary, null, 2));
            } else
            {
                const errorText = await response.text();
                console.error('Failed to save call summary:', errorText);
                setError('Failed to save call summary: ' + errorText);
            }
        } catch (error)
        {
            console.error('Error saving call summary:', error);
            setError('Failed to save call summary: Network error');
        } finally
        {
            isProcessingCallEndRef.current = false;

            // Reset state after a delay
            setTimeout(() =>
            {
                resetCallState();
            }, 2000);
        }
    };

    const resetCallState = () =>
    {
        console.log('Resetting call state...');
        setCallStatus('idle');
        setCallNotes('');
        setPhoneNumber('');
        setIsMuted(false);
        setIsOnHold(false);
        setContactDetails({
            contactId: '',
            customerName: '',
            customerPhone: '',
            reason: '',
            queueName: ''
        });
        setCallTimer(0);
        callStartTime.current = null;
    };

    const handleMute = () =>
    {
        if (!contactRef.current)
        {
            console.error('No active contact');
            setError('No active contact to mute');
            return;
        }

        try
        {
            // Use getAgentConnection() - the most reliable method
            const agentConnection = contactRef.current;



            if (!agentConnection)
            {
                console.error('No agent connection found');
                setError('Unable to find agent connection');
                return;
            }

            console.log('Agent connection found, toggling mute...');

            connect.agent((agent) =>
            {
                if (isMuted)
                {
                    agent.unmute()
                    setIsMuted(false);
                }
                else
                {
                    agent.mute()
                    setIsMuted(true);
                }
            })
        } catch (err)
        {
            console.error('Error toggling mute:', err);
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            setError(`Error toggling mute: ${errorMsg}`);
        }
    };

    const handleHold = () =>
    {
        if (!contactRef.current) return;

        try
        {
            const connection = contactRef.current.getInitialConnection();

            if (isOnHold)
            {
                connection.resume({
                    success: () =>
                    {
                        setIsOnHold(false);
                        console.log('✓ Call resumed');
                        setError('');
                    },
                    failure: (err: any) =>
                    {
                        console.error('Failed to resume:', err);
                        setError('Failed to resume call');
                    }
                });
            } else
            {
                connection.hold({
                    success: () =>
                    {
                        setIsOnHold(true);
                        console.log('✓ Call on hold');
                        setError('');
                    },
                    failure: (err: any) =>
                    {
                        console.error('Failed to hold:', err);
                        setError('Failed to hold call');
                    }
                });
            }
        } catch (err)
        {
            console.error('Error toggling hold:', err);
            setError('Error toggling hold');
        }
    };

    const handleTransfer = () =>
    {
        if (!contactRef.current || !agentRef.current) return;

        // You need to replace this with your actual queue ARN
        const queueARN = 'arn:aws:connect:us-east-1:account-id:instance/instance-id/queue/queue-id';

        try
        {
            const endpoint = window.connect.Endpoint.byQueueARN(queueARN);

            agentRef.current.connect(endpoint, {
                success: () =>
                {
                    console.log('Transfer initiated');
                    setError('');
                },
                failure: (err: any) =>
                {
                    console.error('Failed to transfer:', err);
                    setError('Failed to transfer call');
                }
            });
        } catch (err)
        {
            console.error('Error transferring call:', err);
            setError('Error initiating transfer');
        }
    };
    const handleCloseContact = () =>
    {
        connect.agent(function (agent)
        {
            const contacts = agent.getContacts()
            if (contacts.length > 0)
            {
                const contact = contacts[0];
                contact.complete({
                    success: () =>
                    {
                        console.log('Contact closed successfully.');
                        // Optional: logout after contact close
                        connect.core.terminate();
                        setAgentStatus("Available")
                    },
                    failure: (err) => console.error('Failed to close contact:', err),
                });
            } else
            {
                console.log('No active contact found. Logging out.');
                connect.core.terminate();
            }
        })
    }

    const handleLogout = () =>
    {
        console.log("Logging out...");

        const ccpContainer = document.getElementById("ccp-container");
        if (ccpContainer)
        {
            ccpContainer.innerHTML = "";
        }
        resetCallState()
        sessionStorage.clear();
        localStorage.clear();

        window.open("https://p3fusion-learning.my.connect.aws/login", "_blank");

        window.location.href = "/";
    };


    const getStatusColor = (status: string): ("default" | "secondary" | "destructive" | "outline" | null | undefined) =>
    {
        switch (status)
        {
            case 'Available': return 'default';
            case 'Busy':
            case 'On Call': return 'secondary';
            case 'Offline': return 'outline';
            default: return 'default';
        }
    };

    return (
        <div className="min-h-screen p-6">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-lg">
                            <Phone className="w-6 h-6 " />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold ">P3Fusion HelpDesk</h1>
                            <p className="text-sm">Custom Contact Control Panel</p>
                            {agentName && <p className="text-xs mt-1">Agent: {agentName}</p>}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Badge variant={getStatusColor(agentStatus)} className='rounded-md'>
                                {agentStatus}
                            </Badge>
                        </div>
                        <Button
                            onClick={handleLogout}
                            variant="destructive"
                        >
                            <LogOut className="w-4 h-4 mr-2" />
                            Logout
                        </Button>
                    </div>
                </div>

                {/* Error Alert */}
                {error && (
                    <Alert className="mb-6" variant='destructive'>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                            {error}
                        </AlertDescription>
                    </Alert>
                )}

                {/* Incoming Call Alert */}
                {incomingCall && (
                    <Card className="mb-6 bg-linear-to-r from-green-500/20 to-blue-500/20 border-green-500 animate-pulse">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <PhoneIncoming className="w-8 h-8 text-green-400 animate-bounce" />
                                    <div>
                                        <h3 className="text-xl font-bold ">Incoming Call</h3>
                                        <p className="text-green-300">{contactDetails.customerPhone}</p>
                                        <p className="text-sm ">{contactDetails.reason}</p>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <Button
                                        onClick={handleRejectCall}
                                        variant="destructive"
                                    >
                                        <X className="w-8 h-8" />
                                    </Button>
                                    <Button
                                        onClick={handleAcceptCall}
                                        variant="default"
                                    >
                                        <Check className="w-8 h-8" />
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Agent Status & Controls */}
                    <Card className="">
                        <CardHeader>
                            <CardTitle className="">Agent Controls</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label className="mb-2 block">Agent Status</Label>
                                <Select value={agentStatus} onValueChange={handleStatusChange}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="">
                                        <SelectItem value="Available" className=" hover:bg-slate-600">
                                            Available
                                        </SelectItem>
                                        <SelectItem value="Busy" className=" hover:bg-slate-600">
                                            Busy
                                        </SelectItem>
                                        <SelectItem value="Offline" className=" hover:bg-slate-600">
                                            Offline
                                        </SelectItem>
                                        <SelectItem value='PendingBusy' disabled>
                                            Pending Busy
                                        </SelectItem>
                                        <SelectItem value='AfterCallWork' disabled>
                                            After call work
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {callStatus === 'active' && (
                                <div className="flex items-center gap-2 p-3 bg-green-500/20 rounded-lg border border-green-500">
                                    <Clock className="w-5 h-5 text-green-400" />
                                    <span className="text-green-400 font-mono text-lg">{formatTime(callTimer)}</span>
                                </div>
                            )}

                            {agentStatus != "Offline" && <div className="space-y-2">
                                <Button
                                    onClick={() => setShowDialer(!showDialer)}
                                    className="w-full"
                                // disabled={callStatus === 'active' || incomingCall}
                                >
                                    <Phone className="w-4 h-4 mr-2" />
                                    {showDialer ? 'Hide Dialer' : 'Show Dialer'}
                                </Button>

                                {showDialer && (
                                    <div className="space-y-3 p-4 rounded-lg">
                                        <Input
                                            value={phoneNumber}
                                            onChange={(e) => setPhoneNumber(e.target.value)}
                                            placeholder="Enter phone number"
                                            className="text-center text-lg"
                                        />
                                        <div className="grid grid-cols-3 gap-2">
                                            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
                                                <Button
                                                    key={digit}
                                                    onClick={() => handleDialerClick(digit)}
                                                    variant="outline"
                                                >
                                                    {digit}
                                                </Button>
                                            ))}
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <Button
                                                onClick={handleCall}
                                                variant="default"
                                                disabled={!phoneNumber}
                                            >
                                                <Phone className="w-4 h-4 mr-2" />
                                                Call
                                            </Button>
                                            <Button
                                                onClick={() => setPhoneNumber('')}
                                                variant="outline"
                                            >
                                                Clear
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>}
                            {(agentStatus == "AfterCallWork") && (
                                <Button className='w-full' onClick={handleCloseContact}>
                                    Close contact
                                </Button>
                            )}
                            {(callStatus === 'active') && (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <Button
                                            onClick={handleMute}
                                            variant={isMuted ? "default" : "outline"}
                                        >
                                            {isMuted ? <MicOff className="w-4 h-4 mr-2" /> : <Mic className="w-4 h-4 mr-2" />}
                                            {isMuted ? 'Unmute' : 'Mute'}
                                        </Button>
                                        <Button
                                            onClick={handleHold}
                                            variant={isOnHold ? "default" : "outline"}
                                        >
                                            {isOnHold ? <Play className="w-4 h-4 mr-2" /> : <Pause className="w-4 h-4 mr-2" />}
                                            {isOnHold ? 'Resume' : 'Hold'}
                                        </Button>
                                    </div>
                                    <Button
                                        onClick={handleTransfer}
                                        variant="outline"
                                        className='w-full'
                                    >
                                        <Share2 className="w-4 h-4 mr-2" />
                                        Transfer
                                    </Button>
                                    <Button
                                        onClick={handleEndCall}
                                        variant='destructive'
                                        className='w-full'
                                    >
                                        <PhoneOff className="w-4 h-4 mr-2" />
                                        End Call
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Contact Details */}
                    <Card className="">
                        <CardHeader>
                            <CardTitle className="">Contact Details</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {(callStatus === 'idle') && !incomingCall ? (
                                <Alert className="">
                                    <AlertDescription className="">
                                        No active call. Waiting for incoming call or dial to start.
                                    </AlertDescription>
                                </Alert>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <User className="w-4 h-4" />
                                            Customer Name
                                        </Label>
                                        <Input
                                            value={contactDetails.customerName}
                                            readOnly
                                            className=" "
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <Phone className="w-4 h-4" />
                                            Phone Number
                                        </Label>
                                        <Input
                                            value={contactDetails.customerPhone}
                                            readOnly
                                            className=" "
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="">Contact ID</Label>
                                        <Input
                                            value={contactDetails.contactId}
                                            readOnly
                                            className="  text-xs"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="">Queue</Label>
                                        <Input
                                            value={contactDetails.queueName}
                                            readOnly
                                            className=" "
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="">Call Reason</Label>
                                        <Input
                                            value={contactDetails.reason}
                                            onChange={(e) => setContactDetails({ ...contactDetails, reason: e.target.value })}
                                            className=" "
                                        />
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* Call Notes */}
                    <Card className="">
                        <CardHeader>
                            <CardTitle className=" flex items-center gap-2">
                                <MessageSquare className="w-5 h-5" />
                                Call Notes
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                value={callNotes}
                                onChange={(e) =>
                                {
                                    setCallNotes(e.target.value)
                                    notesRef.current = e.target.value
                                }}
                                placeholder="Enter call notes here..."
                                className="min-h-[300px]   resize-none"
                                disabled={callStatus === 'idle'}
                            />
                            {callStatus === 'wrapup' && (
                                <Alert className="mt-4 bg-blue-500/20 border-blue-500">
                                    <AlertDescription className="text-blue-400">
                                        Complete your call notes before moving to next call
                                    </AlertDescription>
                                </Alert>
                            )}
                        </CardContent>
                    </Card>
                    <div
                        className='h-96 w-96'
                        ref={ccpContainerRef}
                    />
                </div>
            </div>
        </div>
    );
};

export default P3FusionCCP;