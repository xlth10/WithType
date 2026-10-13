import Carbon
import AppKit
import Foundation

@main
struct HotKeyManagerSmokeTest {
    private static var manager: HotKeyManager?
    private static var received = false

    static func main() {
        guard CommandLine.arguments.count == 2 else {
            fputs("Usage: hotkey-manager-smoke <event-sender>\n", stderr)
            exit(2)
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        manager = HotKeyManager {
            received = true
            stopApplicationLoop()
        }

        do {
            try manager?.register()
        } catch {
            fputs("FAIL: \(error.localizedDescription)\n", stderr)
            exit(1)
        }

        let senderPath = CommandLine.arguments[1]
        if senderPath != "--manual" { DispatchQueue.global().asyncAfter(deadline: .now() + 0.2) {
            let sender = Process()
            sender.executableURL = URL(fileURLWithPath: senderPath)
            try? sender.run()
            sender.waitUntilExit()
        } }
        print("READY: press Option-Space", terminator: "\n")
        fflush(stdout)
        DispatchQueue.global().asyncAfter(deadline: .now() + (senderPath == "--manual" ? 45 : 2)) {
            DispatchQueue.main.async { stopApplicationLoop() }
        }

        app.run()
        if received {
            print("PASS: Carbon received ⌥ Space")
            exit(0)
        }
        fputs("FAIL: Carbon did not receive ⌥ Space\n", stderr)
        exit(1)
    }

    private static func stopApplicationLoop() {
        NSApplication.shared.stop(nil)
        if let wakeEvent = NSEvent.otherEvent(
            with: .applicationDefined,
            location: .zero,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: 0,
            context: nil,
            subtype: 0,
            data1: 0,
            data2: 0
        ) {
            NSApplication.shared.postEvent(wakeEvent, atStart: false)
        }
    }
}
