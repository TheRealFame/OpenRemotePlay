/**
 * example.cpp — ORP C++ SDK usage example
 *
 * Build:
 *   Linux/macOS:
 *     g++ -std=c++17 example.cpp -o orp_example \
 *         -ldatachannel -lssl -lcrypto \
 *         -I/path/to/nlohmann_json/include
 *
 *   Windows (MSVC):
 *     cl /std:c++17 example.cpp /link datachannel.lib libssl.lib libcrypto.lib
 */

#include "orp_client.hpp"
#include <iostream>
#include <thread>
#include <chrono>

int main(int argc, char* argv[]) {
    std::string sigUrl     = argc > 1 ? argv[1] : "ws://localhost:3001/signaling";
    std::string pin        = argc > 2 ? argv[2] : "1234";
    std::string name       = argc > 3 ? argv[3] : "CPPBot";

    std::cout << "[ORP] Connecting to " << sigUrl
              << "  session=" << orp::derive_session_id(pin) << '\n';

    orp::Client client(sigUrl, pin, name);

    client.onConnected = [&]() {
        std::cout << "[ORP] DataChannel open! Total: "
                  << client.timings().total_ms() << "ms\n";
    };
    client.onError = [](std::string err) {
        std::cerr << "[ORP] Error: " << err << '\n';
    };
    client.onTimings = [](orp::Timings t) {
        std::cout << "[ORP] Signaling: " << t.signaling_ms - t.start_ms
                  << "ms  DataChannel: " << t.total_ms() << "ms total\n";
    };

    if (!client.connect(2000)) {
        std::cerr << "[ORP] Failed to connect within 2 seconds\n";
        return 1;
    }

    std::cout << "[ORP] Sending neutral gamepad for 5 seconds...\n";
    for (int i = 0; i < 50; ++i) {
        client.sendGamepad({0.f, 0.f, 0.f, 0.f}, std::vector<bool>(17, false));
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    // Example: hold A button for 1 second
    std::cout << "[ORP] Pressing A...\n";
    std::vector<bool> btns(17, false);
    btns[0] = true; // A = index 0 in W3C layout
    for (int i = 0; i < 10; ++i) {
        client.sendGamepad({0.f, 0.f, 0.f, 0.f}, btns);
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    client.disconnect();
    std::cout << "[ORP] Done.\n";
    return 0;
}
