import AppKit
import ApplicationServices

struct InputTarget {
    let pid: pid_t
    let appName: String
    let element: AXUIElement?
    let selectedText: String
    let selection: Data?
    let value: String?

    static func attribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, key as CFString, &result) == .success else { return nil }
        return result
    }
    static func focused() -> AXUIElement? {
        guard let value = attribute(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute),
              CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }
    static func rangeData(_ element: AXUIElement) -> Data? {
        guard let item = attribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(item) == AXValueGetTypeID() else { return nil }
        var range = CFRange()
        guard AXValueGetValue(item as! AXValue, .cfRange, &range) else { return nil }
        return withUnsafeBytes(of: range) { Data($0) }
    }
    static func capture() -> InputTarget? {
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        let element = focused()
        return InputTarget(pid: app.processIdentifier, appName: app.localizedName ?? "",
                           element: element, selectedText: element.flatMap { attribute($0, kAXSelectedTextAttribute) as? String } ?? "",
                           selection: element.flatMap(rangeData), value: element.flatMap { attribute($0, kAXValueAttribute) as? String })
    }
    func stillMatches() -> Bool {
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
              let element, let focused = Self.focused(), CFEqual(element, focused) else { return false }
        if let selection, selection != Self.rangeData(focused) { return false }
        if let value, value != Self.attribute(focused, kAXValueAttribute) as? String { return false }
        return true
    }
}

enum TextInsertion {
    /// Never activates another application. Changed or unreadable targets go to history.
    static func insert(_ text: String, target: InputTarget?) throws {
        guard AXIsProcessTrusted() else { throw WritingError.message("需要辅助功能权限；结果已保留，可从菜单复制") }
        guard let target, target.stillMatches() else {
            throw WritingError.message("输入位置已变化或无法确认；结果已保留，请从菜单复制")
        }
        let board = NSPasteboard.general
        let previous = board.pasteboardItems?.map { item -> NSPasteboardItem in
            let copy = NSPasteboardItem()
            for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
            return copy
        } ?? []
        guard let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else {
            throw WritingError.message("无法发送粘贴操作；结果已保留")
        }
        board.clearContents()
        guard board.setString(text, forType: .string) else { throw WritingError.message("无法写入剪贴板；结果已保留") }
        let change = board.changeCount
        down.flags = .maskCommand; up.flags = .maskCommand
        down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            guard board.changeCount == change else { return }
            board.clearContents()
            board.writeObjects(previous)
        }
    }
}
