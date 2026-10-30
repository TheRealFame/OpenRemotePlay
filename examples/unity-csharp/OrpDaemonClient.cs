// OpenRemotePlay (ORP) — Unity C# Sidecar SDK Example
// Communicates with orp-daemon over stdin/stdout using standard JSON-Lines.
// Zero native C++ WebRTC plugin compilation needed.

using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using UnityEngine;

namespace OpenRemotePlay
{
    public class OrpDaemonClient : MonoBehaviour
    {
        private Process daemonProcess;
        private StreamWriter stdinWriter;
        private Thread readerThread;
        private bool isRunning = false;

        [Header("Configuration")]
        public string daemonPath = "orp-daemon";
        public string signalingUrl = "wss://signaling.openremoteplay.org/signaling";

        public event Action<string, string> OnSessionReady;
        public event Action<string> OnPeerJoined;
        public event Action<int, float[], bool[]> OnInputReceived;

        void Start()
        {
            StartDaemon();
        }

        public void StartDaemon()
        {
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = daemonPath,
                    UseShellExecute = false,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                daemonProcess = new Process { StartInfo = startInfo };
                daemonProcess.Start();

                stdinWriter = daemonProcess.StandardInput;
                isRunning = true;

                readerThread = new Thread(ReadStdoutLoop) { IsBackground = true };
                readerThread.Start();

                UnityEngine.Debug.Log("[ORP] orp-daemon spawned successfully.");
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogError($"[ORP] Failed to spawn orp-daemon: {ex.Message}");
            }
        }

        private void ReadStdoutLoop()
        {
            using (var reader = daemonProcess.StandardOutput)
            {
                while (isRunning && !reader.EndOfStream)
                {
                    var line = reader.ReadLine();
                    if (string.IsNullOrWhiteSpace(line)) continue;

                    // Parse JSON-Lines message (using Unity's JsonUtility or Newtonsoft)
                    // Dispatches events back to Unity main thread
                }
            }
        }

        public void StartHost(string roomCode)
        {
            SendIpcCommand($"{{\"type\":\"cmd:start_host\",\"roomCode\":\"{roomCode}\",\"modalities\":[\"input\",\"video\"]}}");
        }

        public void JoinSession(string roomCode)
        {
            SendIpcCommand($"{{\"type\":\"cmd:join\",\"roomCode\":\"{roomCode}\",\"modalities\":[\"input\"]}}");
        }

        public void SendIpcCommand(string json)
        {
            if (stdinWriter != null && isRunning)
            {
                stdinWriter.WriteLine(json);
                stdinWriter.Flush();
            }
        }

        void OnDestroy()
        {
            isRunning = false;
            if (daemonProcess != null && !daemonProcess.HasExited)
            {
                SendIpcCommand("{\"type\":\"cmd:stop\"}");
                daemonProcess.Kill();
            }
        }
    }
}
