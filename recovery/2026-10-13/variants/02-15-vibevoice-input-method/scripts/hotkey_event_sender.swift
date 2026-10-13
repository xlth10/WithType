import CoreGraphics
import Foundation

guard let source = CGEventSource(stateID: .hidSystemState),
      let down = CGEvent(keyboardEventSource: source, virtualKey: 49, keyDown: true),
      let up = CGEvent(keyboardEventSource: source, virtualKey: 49, keyDown: false) else {
    exit(1)
}

down.flags = .maskAlternate
up.flags = .maskAlternate
down.post(tap: .cghidEventTap)
usleep(80_000)
up.post(tap: .cghidEventTap)
