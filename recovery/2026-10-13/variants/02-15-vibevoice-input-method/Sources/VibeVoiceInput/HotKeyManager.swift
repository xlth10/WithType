import AppKit
import Carbon
import Foundation

struct GlobalShortcut: Codable, Equatable {
    static let `default` = GlobalShortcut(
        uncheckedKeyCode: UInt32(kVK_Space),
        carbonModifiers: UInt32(optionKey)
    )

    let keyCode: UInt32
    let carbonModifiers: UInt32

    private static let supportedModifiers = UInt32(cmdKey | optionKey | controlKey | shiftKey)
    private static let storageKey = "globalShortcut"

    init?(keyCode: UInt32, carbonModifiers: UInt32) {
        let modifiers = carbonModifiers & Self.supportedModifiers
        guard modifiers != 0, Self.isUsableKey(keyCode) else { return nil }
        self.keyCode = keyCode
        self.carbonModifiers = modifiers
    }

    init?(event: NSEvent) {
        var modifiers: UInt32 = 0
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags.contains(.command) { modifiers |= UInt32(cmdKey) }
        if flags.contains(.option) { modifiers |= UInt32(optionKey) }
        if flags.contains(.control) { modifiers |= UInt32(controlKey) }
        if flags.contains(.shift) { modifiers |= UInt32(shiftKey) }
        self.init(keyCode: UInt32(event.keyCode), carbonModifiers: modifiers)
    }

    private init(uncheckedKeyCode: UInt32, carbonModifiers: UInt32) {
        keyCode = uncheckedKeyCode
        self.carbonModifiers = carbonModifiers
    }

    var displayName: String {
        var parts: [String] = []
        if carbonModifiers & UInt32(controlKey) != 0 { parts.append("⌃") }
        if carbonModifiers & UInt32(optionKey) != 0 { parts.append("⌥") }
        if carbonModifiers & UInt32(shiftKey) != 0 { parts.append("⇧") }
        if carbonModifiers & UInt32(cmdKey) != 0 { parts.append("⌘") }
        parts.append(Self.keyName(keyCode))
        return parts.joined(separator: " ")
    }

    static func load(defaults: UserDefaults = .standard) -> Self {
        guard let data = defaults.data(forKey: storageKey),
              let shortcut = try? JSONDecoder().decode(Self.self, from: data) else { return .default }
        return shortcut
    }

    func save(defaults: UserDefaults = .standard) {
        defaults.set(try? JSONEncoder().encode(self), forKey: Self.storageKey)
    }

    private static func isUsableKey(_ keyCode: UInt32) -> Bool {
        let forbidden = [
            kVK_Command, kVK_Shift, kVK_CapsLock, kVK_Option, kVK_Control,
            kVK_RightCommand, kVK_RightShift, kVK_RightOption, kVK_RightControl,
            kVK_Function, kVK_Escape
        ].map(UInt32.init)
        return !forbidden.contains(keyCode)
    }

    private static func keyName(_ code: UInt32) -> String {
        let names: [UInt32: String] = [
            UInt32(kVK_Space): "Space", UInt32(kVK_Return): "Return",
            UInt32(kVK_Tab): "Tab", UInt32(kVK_Delete): "Delete",
            UInt32(kVK_ForwardDelete): "Forward Delete", UInt32(kVK_Home): "Home",
            UInt32(kVK_End): "End", UInt32(kVK_PageUp): "Page Up",
            UInt32(kVK_PageDown): "Page Down", UInt32(kVK_LeftArrow): "←",
            UInt32(kVK_RightArrow): "→", UInt32(kVK_UpArrow): "↑",
            UInt32(kVK_DownArrow): "↓", UInt32(kVK_ANSI_Minus): "-",
            UInt32(kVK_ANSI_Equal): "=", UInt32(kVK_ANSI_LeftBracket): "[",
            UInt32(kVK_ANSI_RightBracket): "]", UInt32(kVK_ANSI_Backslash): "\\",
            UInt32(kVK_ANSI_Semicolon): ";", UInt32(kVK_ANSI_Quote): "'",
            UInt32(kVK_ANSI_Comma): ",", UInt32(kVK_ANSI_Period): ".",
            UInt32(kVK_ANSI_Slash): "/", UInt32(kVK_ANSI_Grave): "`"
        ]
        if let name = names[code] { return name }

        let ordinary: [(Int, String)] = [
            (kVK_ANSI_A, "A"), (kVK_ANSI_B, "B"), (kVK_ANSI_C, "C"), (kVK_ANSI_D, "D"),
            (kVK_ANSI_E, "E"), (kVK_ANSI_F, "F"), (kVK_ANSI_G, "G"), (kVK_ANSI_H, "H"),
            (kVK_ANSI_I, "I"), (kVK_ANSI_J, "J"), (kVK_ANSI_K, "K"), (kVK_ANSI_L, "L"),
            (kVK_ANSI_M, "M"), (kVK_ANSI_N, "N"), (kVK_ANSI_O, "O"), (kVK_ANSI_P, "P"),
            (kVK_ANSI_Q, "Q"), (kVK_ANSI_R, "R"), (kVK_ANSI_S, "S"), (kVK_ANSI_T, "T"),
            (kVK_ANSI_U, "U"), (kVK_ANSI_V, "V"), (kVK_ANSI_W, "W"), (kVK_ANSI_X, "X"),
            (kVK_ANSI_Y, "Y"), (kVK_ANSI_Z, "Z"),
            (kVK_ANSI_0, "0"), (kVK_ANSI_1, "1"), (kVK_ANSI_2, "2"), (kVK_ANSI_3, "3"),
            (kVK_ANSI_4, "4"), (kVK_ANSI_5, "5"), (kVK_ANSI_6, "6"), (kVK_ANSI_7, "7"),
            (kVK_ANSI_8, "8"), (kVK_ANSI_9, "9"),
            (kVK_F1, "F1"), (kVK_F2, "F2"), (kVK_F3, "F3"), (kVK_F4, "F4"),
            (kVK_F5, "F5"), (kVK_F6, "F6"), (kVK_F7, "F7"), (kVK_F8, "F8"),
            (kVK_F9, "F9"), (kVK_F10, "F10"), (kVK_F11, "F11"), (kVK_F12, "F12")
        ]
        return ordinary.first(where: { UInt32($0.0) == code })?.1 ?? "Key \(code)"
    }

    private enum CodingKeys: String, CodingKey { case keyCode, carbonModifiers }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let keyCode = try values.decode(UInt32.self, forKey: .keyCode)
        let modifiers = try values.decode(UInt32.self, forKey: .carbonModifiers)
        guard let valid = Self(keyCode: keyCode, carbonModifiers: modifiers) else {
            throw DecodingError.dataCorruptedError(
                forKey: .carbonModifiers,
                in: values,
                debugDescription: "Global shortcut must contain a usable key and at least one modifier."
            )
        }
        self = valid
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(keyCode, forKey: .keyCode)
        try values.encode(carbonModifiers, forKey: .carbonModifiers)
    }
}

enum HotKeyRegistrationError: LocalizedError {
    case installHandler(OSStatus)
    case registerHotKey(OSStatus, String)

    var errorDescription: String? {
        switch self {
        case .installHandler(let status):
            return "无法安装快捷键处理器（错误 \(status)）"
        case .registerHotKey(let status, let shortcut):
            if status == eventHotKeyExistsErr { return "\(shortcut) 已被其他应用占用" }
            return "无法注册 \(shortcut)（错误 \(status)）"
        }
    }
}

final class HotKeyManager {
    fileprivate static let signature: OSType = 0x5656494D // "VVIM"
    fileprivate static let identifier: UInt32 = 1

    private let shortcut: GlobalShortcut
    private let action: () -> Void
    private var eventHandler: EventHandlerRef?
    private var hotKey: EventHotKeyRef?

    init(shortcut: GlobalShortcut, action: @escaping () -> Void) {
        self.shortcut = shortcut
        self.action = action
    }

    func register() throws {
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let pointer = Unmanaged.passUnretained(self).toOpaque()
        let handlerStatus = InstallEventHandler(
            GetApplicationEventTarget(), hotKeyEventHandler, 1, &eventType, pointer, &eventHandler
        )
        guard handlerStatus == noErr else { throw HotKeyRegistrationError.installHandler(handlerStatus) }

        let hotKeyID = EventHotKeyID(signature: Self.signature, id: Self.identifier)
        let registerStatus = RegisterEventHotKey(
            shortcut.keyCode,
            shortcut.carbonModifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKey
        )
        guard registerStatus == noErr else {
            if let eventHandler { RemoveEventHandler(eventHandler) }
            eventHandler = nil
            throw HotKeyRegistrationError.registerHotKey(registerStatus, shortcut.displayName)
        }
    }

    fileprivate func invoke() { action() }

    deinit {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }
}

private let hotKeyEventHandler: EventHandlerUPP = { _, event, userData in
    guard let event, let userData else { return OSStatus(eventNotHandledErr) }
    var hotKeyID = EventHotKeyID()
    let status = GetEventParameter(
        event,
        EventParamName(kEventParamDirectObject),
        EventParamType(typeEventHotKeyID),
        nil,
        MemoryLayout<EventHotKeyID>.size,
        nil,
        &hotKeyID
    )
    guard status == noErr,
          hotKeyID.signature == HotKeyManager.signature,
          hotKeyID.id == HotKeyManager.identifier else { return OSStatus(eventNotHandledErr) }
    Unmanaged<HotKeyManager>.fromOpaque(userData).takeUnretainedValue().invoke()
    return noErr
}
