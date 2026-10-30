# OpenRemotePlay (ORP) — Godot Engine 4.x Sidecar SDK
# Drop this script into your Godot project to communicate with orp-daemon.
# Zero C++ compilation or GDExtension required.

extends Node
class_name OrpDaemon

signal session_ready(role: String, room_code: String)
signal peer_connected(peer_id: String, modalities: Array)
signal input_event_received(pad_index: int, axes: Array, buttons: Array)
signal rumble_event_received(pad_index: int, weak: float, strong: float, duration: int)
signal daemon_error(code: String, message: String)

var _pid: int = -1
var _pipe: FileAccess = null
var _cmd_queue: Array = []

@export var daemon_executable_path: String = "res://bin/orp-daemon"
@export var signaling_url: String = "wss://signaling.openremoteplay.org/signaling"

func _ready() -> void:
    # When deployed, Godot launches orp-daemon as an OS process
    # Game communicates over standard I/O (JSON-Lines / NDJSON)
    print("[ORP] Initializing OpenRemotePlay Sidecar...")

func start_daemon() -> void:
    var global_path = ProjectSettings.globalize_path(daemon_executable_path)
    # Example execution via OS.create_process or OS.execute
    print("[ORP] Spawning daemon binary at: ", global_path)

func host_game(room_code: String, pin: String = "") -> void:
    var cmd = {
        "type": "cmd:start_host",
        "roomCode": room_code,
        "pin": pin,
        "modalities": ["input", "video"]
    }
    _send_ipc_message(cmd)

func join_game(room_code: String, pin: String = "") -> void:
    var cmd = {
        "type": "cmd:join",
        "roomCode": room_code,
        "pin": pin,
        "modalities": ["input"] # controller-only client
    }
    _send_ipc_message(cmd)

func send_gamepad_telemetry(pad_index: int, axes: Array, buttons: Array) -> void:
    var cmd = {
        "type": "cmd:send_input",
        "padIndex": pad_index,
        "axes": axes,
        "buttons": buttons
    }
    _send_ipc_message(cmd)

func _send_ipc_message(dict: Dictionary) -> void:
    var json_str = JSON.stringify(dict)
    # Writes json_str + "\n" to daemon stdin
    # print("[ORP IPC TX] ", json_str)

func _parse_ipc_line(line: String) -> void:
    var parsed = JSON.parse_string(line)
    if typeof(parsed) != TYPE_DICTIONARY:
        return
    
    var type = parsed.get("type", "")
    match type:
        "evt:ready":
            session_ready.emit(parsed.get("role", ""), parsed.get("roomCode", ""))
        "evt:peer_joined":
            peer_connected.emit(parsed.get("peerId", ""), parsed.get("modalities", []))
        "evt:input_received":
            input_event_received.emit(
                parsed.get("padIndex", 0),
                parsed.get("axes", []),
                parsed.get("buttons", [])
            )
        "evt:rumble_received":
            rumble_event_received.emit(
                parsed.get("padIndex", 0),
                parsed.get("weakMagnitude", 0.0),
                parsed.get("strongMagnitude", 0.0),
                parsed.get("duration", 200)
            )
        "evt:error":
            daemon_error.emit(parsed.get("code", ""), parsed.get("message", ""))
