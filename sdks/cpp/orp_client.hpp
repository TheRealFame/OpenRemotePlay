/**
 * orp_client.hpp — OpenRemotePlay C++ SDK v1.0
 * License: MIT
 *
 * Single-header C++ ORP v2 viewer client.
 * Dependencies: libdatachannel (https://github.com/paullouisageneau/libdatachannel)
 *               nlohmann/json  (https://github.com/nlohmann/json)
 *               OpenSSL        (for HMAC-SHA256)
 *
 * Usage:
 *   #include "orp_client.hpp"
 *
 *   orp::Client client("ws://192.168.1.5:3001/signaling", "1234");
 *   client.onConnected = [](){ printf("Connected!\n"); };
 *   client.connect();
 *   client.sendGamepad({0.f,0.f,0.f,0.f}, std::vector<bool>(17,false));
 *   client.disconnect();
 */

#pragma once
#include <string>
#include <vector>
#include <functional>
#include <thread>
#include <mutex>
#include <atomic>
#include <chrono>
#include <stdexcept>
#include <sstream>
#include <iomanip>
#include <cstring>

// ── Third-party includes ──────────────────────────────────────────────────────
#include <rtc/rtc.hpp>     // libdatachannel
#include <nlohmann/json.hpp>

#ifdef _WIN32
#  include <winsock2.h>
#else
#  include <openssl/hmac.h>
#  include <openssl/sha.h>
#endif

namespace orp {

using json = nlohmann::json;

// ── HMAC-SHA256 ───────────────────────────────────────────────────────────────

inline std::string hmac_sha256_hex(const std::string& key, const std::string& data) {
#ifdef _WIN32
    // Windows: use BCrypt or a bundled impl — placeholder returns empty
    (void)key; (void)data;
    return std::string(64, '0');
#else
    unsigned char digest[32];
    unsigned int  len = 32;
    HMAC(EVP_sha256(),
         key.data(),  static_cast<int>(key.size()),
         reinterpret_cast<const unsigned char*>(data.data()), static_cast<int>(data.size()),
         digest, &len);
    std::ostringstream ss;
    for (unsigned i = 0; i < len; ++i)
        ss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(digest[i]);
    return ss.str();
#endif
}

// ── Session ID derivation ─────────────────────────────────────────────────────

/// Mirrors the JS/Python deriveSessionId: HMAC-SHA256("orp-v2-room", pin)[0:20]
inline std::string derive_session_id(const std::string& pin) {
    return hmac_sha256_hex("orp-v2-room", pin).substr(0, 20);
}

// ── Timing ────────────────────────────────────────────────────────────────────

struct Timings {
    double start_ms{};
    double signaling_ms{-1};
    double ice_ms{-1};
    double datachannel_ms{-1};
    double total_ms() const {
        return datachannel_ms >= 0 ? datachannel_ms - start_ms : -1;
    }
};

static double now_ms() {
    using namespace std::chrono;
    return duration_cast<duration<double, std::milli>>(
        steady_clock::now().time_since_epoch()).count();
}

// ── Button state ──────────────────────────────────────────────────────────────

struct ButtonState {
    bool  pressed{false};
    float value{0.f};
};

// ── Client ────────────────────────────────────────────────────────────────────

class Client {
public:
    // ── Callbacks ──────────────────────────────────────────────────────────────
    std::function<void()>            onConnected;
    std::function<void()>            onDisconnected;
    std::function<void(std::string)> onError;
    std::function<void(Timings)>     onTimings;

    // ── Constructor ────────────────────────────────────────────────────────────
    Client(std::string signalingUrl, std::string pin,
           std::string displayName = "CPPBot")
        : _sigUrl(std::move(signalingUrl))
        , _pin(std::move(pin))
        , _displayName(std::move(displayName))
        , _sessionId(derive_session_id(_pin))
        , _senderId(_make_uuid())
    {}

    ~Client() { disconnect(); }

    // ── connect ────────────────────────────────────────────────────────────────
    /// Blocking connect. Returns true on success within 2 seconds.
    bool connect(int timeout_ms = 2000) {
        _timings.start_ms = now_ms();
        _running = true;

        _setupPeerConnection();

        // Connect WebSocket for signaling
        _ws = std::make_shared<rtc::WebSocket>();

        _ws->onOpen([this]() {
            _sendJoin();
        });

        _ws->onMessage([this](rtc::message_variant msg) {
            if (!std::holds_alternative<std::string>(msg)) return;
            _handleSignaling(std::get<std::string>(msg));
        });

        _ws->onError([this](std::string err) {
            _fireError("WebSocket error: " + err);
        });

        _ws->onClosed([this]() {
            if (_running && !_channelOpen)
                _fireError("WebSocket closed before DataChannel opened");
        });

        _ws->open(_sigUrl);

        // Wait for DataChannel to open (or timeout)
        auto deadline = std::chrono::steady_clock::now()
                        + std::chrono::milliseconds(timeout_ms);
        while (!_channelOpen && _running) {
            if (std::chrono::steady_clock::now() > deadline) {
                _fireError("Connection timeout (>2s)");
                return false;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
        return _channelOpen.load();
    }

    // ── disconnect ─────────────────────────────────────────────────────────────
    void disconnect() {
        _running = false;
        if (_channel) { _channel->close(); _channel.reset(); }
        if (_pc)      { _pc->close();      _pc.reset();      }
        if (_ws)      { _ws->close();      _ws.reset();      }
        if (onDisconnected) onDisconnected();
    }

    // ── sendGamepad ────────────────────────────────────────────────────────────
    /// Send W3C Standard Gamepad state.
    /// axes[4]:   [LX, LY, RX, RY]  -1.0 to 1.0
    /// buttons:   17 booleans (W3C layout)
    void sendGamepad(std::array<float,4> axes,
                     const std::vector<bool>& buttons,
                     int padIndex = 0) {
        if (!_channelOpen) return;
        json btns = json::array();
        for (size_t i = 0; i < 17; ++i) {
            bool p = i < buttons.size() && buttons[i];
            btns.push_back({{"pressed", p}, {"value", p ? 1.0f : 0.0f}});
        }
        json payload = {
            {"type",     "gamepad"},
            {"viewerId", _senderId},
            {"pad_id",   _senderId + "_" + std::to_string(padIndex)},
            {"padIndex", padIndex},
            {"axes",     {axes[0], axes[1], axes[2], axes[3]}},
            {"buttons",  btns},
        };
        _sendData(payload.dump());
    }

    /// Send W3C gamepad using ButtonState structs (includes analog values).
    void sendGamepadFull(std::array<float,4> axes,
                         const std::vector<ButtonState>& buttons,
                         int padIndex = 0) {
        if (!_channelOpen) return;
        json btns = json::array();
        for (size_t i = 0; i < 17; ++i) {
            if (i < buttons.size())
                btns.push_back({{"pressed", buttons[i].pressed}, {"value", buttons[i].value}});
            else
                btns.push_back({{"pressed", false}, {"value", 0.f}});
        }
        json payload = {
            {"type",     "gamepad"},
            {"viewerId", _senderId},
            {"pad_id",   _senderId + "_" + std::to_string(padIndex)},
            {"padIndex", padIndex},
            {"axes",     {axes[0], axes[1], axes[2], axes[3]}},
            {"buttons",  btns},
        };
        _sendData(payload.dump());
    }

    // ── sendKbm ────────────────────────────────────────────────────────────────
    void sendKbm(const std::string& event, const std::string& key = "",
                 int dx = 0, int dy = 0) {
        if (!_channelOpen) return;
        json payload = {
            {"type",     "keyboard"},
            {"viewerId", _senderId},
            {"event",    event},
            {"key",      key},
            {"dx",       dx},
            {"dy",       dy},
        };
        _sendData(payload.dump());
    }

    // ── Accessors ──────────────────────────────────────────────────────────────
    bool         isConnected()  const { return _channelOpen.load(); }
    const Timings& timings()    const { return _timings; }
    std::string  sessionId()    const { return _sessionId; }
    std::string  senderId()     const { return _senderId; }

private:
    std::string _sigUrl, _pin, _displayName, _sessionId, _senderId;
    Timings     _timings;

    std::shared_ptr<rtc::WebSocket>         _ws;
    std::shared_ptr<rtc::PeerConnection>    _pc;
    std::shared_ptr<rtc::DataChannel>       _channel;

    std::atomic<bool> _running{false};
    std::atomic<bool> _channelOpen{false};

    // ── Signing ────────────────────────────────────────────────────────────────
    std::string _sign(json& payload) {
        payload["sig"] = "";
        std::string serialized = payload.dump();
        return hmac_sha256_hex(_pin, serialized);
    }

    // ── Envelope builder ───────────────────────────────────────────────────────
    json _envelope(const std::string& type) {
        json env = {
            {"v",           2},
            {"type",        type},
            {"senderId",    _senderId},
            {"sessionId",   _sessionId},
            {"sig",         ""},
            {"ts",          static_cast<int64_t>(
                std::chrono::duration_cast<std::chrono::milliseconds>(
                    std::chrono::system_clock::now().time_since_epoch()).count())},
            {"displayName", _displayName},
        };
        env["sig"] = _sign(env);
        return env;
    }

    // ── PeerConnection setup ───────────────────────────────────────────────────
    void _setupPeerConnection() {
        rtc::Configuration config;
        config.iceServers = {
            rtc::IceServer{"stun:stun.l.google.com:19302"},
            rtc::IceServer{"stun:stun.cloudflare.com:3478"},
        };
        _pc = std::make_shared<rtc::PeerConnection>(config);

        // Trickle ICE — AGENTS.md: mandatory
        _pc->onLocalCandidate([this](rtc::Candidate cand) {
            json env = _envelope("ice-candidate");
            env["candidate"] = {
                {"candidate",     static_cast<std::string>(cand)},
                {"sdpMid",        cand.mid()},
                {"sdpMLineIndex", 0},
            };
            if (_ws && _ws->isOpen())
                _ws->send(env.dump());
        });

        _pc->onDataChannel([this](std::shared_ptr<rtc::DataChannel> ch) {
            _channel = ch;
            _channel->onOpen([this]() { _onChannelOpen(); });
            _channel->onClosed([this]() { _channelOpen = false; });
        });
    }

    // ── Signaling handler ──────────────────────────────────────────────────────
    void _handleSignaling(const std::string& raw) {
        json msg;
        try { msg = json::parse(raw); } catch (...) { return; }
        const std::string type = msg.value("type", "");

        if (type == "offer") {
            _timings.signaling_ms = now_ms();
            std::string sdp = msg.value("sdp", "");
            _pc->setRemoteDescription(rtc::Description(sdp, "offer"));
            _pc->setLocalDescription();  // creates answer
            _pc->onLocalDescription([this](rtc::Description desc) {
                json env = _envelope("answer");
                env["sdp"] = std::string(desc);
                if (_ws && _ws->isOpen())
                    _ws->send(env.dump());
            });
        } else if (type == "ice-candidate") {
            auto cand = msg["candidate"];
            std::string c = cand.value("candidate", "");
            std::string mid = cand.value("sdpMid", "0");
            if (!c.empty())
                _pc->addRemoteCandidate(rtc::Candidate(c, mid));
        } else if (type == "error") {
            _fireError("Server: " + msg.value("message", raw));
        }
    }

    void _sendJoin() {
        json env = _envelope("join");
        _ws->send(env.dump());
        // Create DataChannel AFTER join (viewer role doesn't create offer)
        // The host will send an offer; we answer it.
        // In ORP v2 the host sends offer first on seeing a join.
    }

    void _onChannelOpen() {
        _timings.datachannel_ms = now_ms();
        _channelOpen = true;
        if (onTimings)   onTimings(_timings);
        if (onConnected) onConnected();
    }

    void _sendData(const std::string& s) {
        try { if (_channel && _channel->isOpen()) _channel->send(s); }
        catch (...) {}
    }

    void _fireError(const std::string& msg) {
        if (onError) onError(msg);
    }

    // ── UUID (simple v4 approximation) ────────────────────────────────────────
    static std::string _make_uuid() {
        static thread_local std::mt19937 rng(std::random_device{}());
        std::uniform_int_distribution<uint32_t> dist(0, 0xFFFFFFFF);
        std::ostringstream ss;
        ss << std::hex << std::setfill('0')
           << std::setw(8) << dist(rng) << '-'
           << std::setw(4) << (dist(rng) & 0xFFFF) << '-'
           << std::setw(4) << ((dist(rng) & 0x0FFF) | 0x4000) << '-'
           << std::setw(4) << ((dist(rng) & 0x3FFF) | 0x8000) << '-'
           << std::setw(12) << ((uint64_t)dist(rng) << 16 | (dist(rng) & 0xFFFF));
        return ss.str();
    }
};

} // namespace orp
