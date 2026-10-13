import Carbon
import XCTest
@testable import VibeVoiceInput

final class HotKeyShortcutTests: XCTestCase {
    func testDefaultShortcutIsOptionSpace() {
        XCTAssertEqual(GlobalShortcut.default.keyCode, UInt32(kVK_Space))
        XCTAssertEqual(GlobalShortcut.default.carbonModifiers, UInt32(optionKey))
        XCTAssertEqual(GlobalShortcut.default.displayName, "⌥ Space")
    }

    func testShortcutRequiresModifierAndRoundTrips() throws {
        XCTAssertNil(GlobalShortcut(keyCode: UInt32(kVK_ANSI_R), carbonModifiers: 0))

        let shortcut = try XCTUnwrap(GlobalShortcut(
            keyCode: UInt32(kVK_ANSI_R),
            carbonModifiers: UInt32(shiftKey | cmdKey)
        ))
        XCTAssertEqual(shortcut.displayName, "⇧ ⌘ R")

        let data = try JSONEncoder().encode(shortcut)
        XCTAssertEqual(try JSONDecoder().decode(GlobalShortcut.self, from: data), shortcut)
    }

    func testCorruptedPersistedShortcutFallsBackToDefault() throws {
        let invalid = Data("{\"keyCode\":15,\"carbonModifiers\":0}".utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(GlobalShortcut.self, from: invalid))
    }
}
