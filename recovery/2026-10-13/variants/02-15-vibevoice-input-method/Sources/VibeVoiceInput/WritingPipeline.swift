import Foundation
import Security

enum WritingMode: String, CaseIterable, Codable {
    case original, corrected, clean, translate, edit
    var title: String {
        switch self {
        case .original: return "原文（本地）"
        case .corrected: return "本地术语纠错"
        case .clean: return "轻度整理"
        case .translate: return "翻译为英文"
        case .edit: return "语音修改选中文字"
        }
    }

    var requiresBackend: Bool {
        switch self {
        case .clean, .translate, .edit: return true
        case .original, .corrected: return false
        }
    }
}

struct WritingSettings: Codable {
    var endpoint = ""
    var model = ""
    var vocabulary = ""
    var mode: WritingMode = .original
    var includeAppContext = false
    static func load() -> Self {
        guard let data = UserDefaults.standard.data(forKey: "writingSettings"),
              let value = try? JSONDecoder().decode(Self.self, from: data) else { return Self() }
        return value
    }
    func save() { UserDefaults.standard.set(try? JSONEncoder().encode(self), forKey: "writingSettings") }
    /// A missing optional writing backend must not disable local dictation.
    func usableAtLaunch() -> Self {
        guard mode.requiresBackend, (try? validatedURL()) == nil else { return self }
        var usable = self
        usable.mode = .original
        return usable
    }
    func validatedURL() throws -> URL {
        guard let url = URL(string: endpoint), let host = url.host,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)),
              !model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw WritingError.message("请填写 HTTPS Chat Completions 完整地址和模型名；本机服务允许 HTTP。")
        }
        return url
    }
}

enum WritingError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}

enum ModelCredential {
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "VibeVoiceInput.WritingModel",
         kSecAttrAccount as String: "api-key"]
    }
    static func read() -> String {
        var request = query
        request[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
    static func save(_ key: String) throws {
        let values = [kSecValueData as String: Data(key.utf8)]
        var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            var request = query
            values.forEach { request[$0.key] = $0.value }
            request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(request as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw WritingError.message("无法保存模型密钥（\(status)）") }
    }
}

/// Sends text only. Audio capture and transcription remain local.
final class WritingProcessor: NSObject, URLSessionTaskDelegate, PolishBackend {
    private let configuration: URLSessionConfiguration
    private let credential: () -> String
    init(configuration: URLSessionConfiguration = .ephemeral, credential: @escaping () -> String = ModelCredential.read) {
        self.configuration = configuration
        self.credential = credential
        super.init()
    }
    private lazy var session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
    func complete(messages: [[String: String]], settings: WritingSettings) async throws -> String {
        var request = URLRequest(url: try settings.validatedURL())
        request.httpMethod = "POST"
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let key = credential()
        if !key.isEmpty { request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": settings.model, "stream": false,
            "messages": messages
        ])
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            throw WritingError.message("文字整理服务返回错误，请检查地址、密钥和模型。")
        }
        struct Response: Decodable {
            struct Choice: Decodable { struct Message: Decodable { let content: String? }; let message: Message }
            let choices: [Choice]
        }
        let result = try JSONDecoder().decode(Response.self, from: data).choices.first?.message.content?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !result.isEmpty else { throw WritingError.message("文字整理服务没有返回文字") }
        return result
    }
}

struct DictationEntry: Codable {
    var id = UUID()
    var date = Date()
    var original: String
    var result: String
    var mode: WritingMode
    var status: String
    var recognitionSeconds: Double
    var processingSeconds: Double
    var corrected: String? = nil
    var command: String? = nil
}

final class DictationHistory {
    private(set) var entries: [DictationEntry] = []
    private let url: URL
    init(url: URL? = nil) {
        self.url = url ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("VibeVoiceInput/history.json")
        if let data = try? Data(contentsOf: self.url), let entries = try? JSONDecoder().decode([DictationEntry].self, from: data) {
            self.entries = entries
        }
    }
    func add(_ entry: DictationEntry) throws {
        entries.insert(entry, at: 0)
        entries = Array(entries.prefix(50))
        try persist()
    }
    private func persist() throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(entries).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
