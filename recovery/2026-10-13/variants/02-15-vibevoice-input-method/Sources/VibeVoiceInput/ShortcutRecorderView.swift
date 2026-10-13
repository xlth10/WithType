import AppKit

final class ShortcutRecorderView: NSView {
    private(set) var shortcut: GlobalShortcut
    private var capturing = false

    init(shortcut: GlobalShortcut) {
        self.shortcut = shortcut
        super.init(frame: NSRect(x: 0, y: 0, width: 320, height: 44))
    }

    required init?(coder: NSCoder) { nil }
    override var acceptsFirstResponder: Bool { true }

    override func becomeFirstResponder() -> Bool {
        capturing = true
        needsDisplay = true
        return true
    }

    override func resignFirstResponder() -> Bool {
        capturing = false
        needsDisplay = true
        return true
    }

    override func mouseDown(with event: NSEvent) { window?.makeFirstResponder(self) }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            window?.makeFirstResponder(nil)
            return
        }
        guard let candidate = GlobalShortcut(event: event) else {
            NSSound.beep()
            return
        }
        shortcut = candidate
        window?.makeFirstResponder(nil)
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let box = bounds.insetBy(dx: 1, dy: 1)
        let path = NSBezierPath(roundedRect: box, xRadius: 7, yRadius: 7)
        NSColor.controlBackgroundColor.setFill()
        path.fill()
        (capturing ? NSColor.controlAccentColor : NSColor.separatorColor).setStroke()
        path.lineWidth = capturing ? 2 : 1
        path.stroke()

        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let text = capturing ? "请按下新的组合键…" : shortcut.displayName
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 16, weight: .medium),
            .foregroundColor: NSColor.labelColor,
            .paragraphStyle: paragraph
        ]
        let size = (text as NSString).size(withAttributes: attributes)
        let rect = NSRect(x: 8, y: (bounds.height - size.height) / 2, width: bounds.width - 16, height: size.height)
        (text as NSString).draw(in: rect, withAttributes: attributes)
    }
}
