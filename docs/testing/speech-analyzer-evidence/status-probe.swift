import Foundation
import Speech

@main
struct ReadOnlySpeechStatus {
    static func main() async {
        if #available(macOS 26.0, *) {
            let locale = Locale(identifier: "zh-CN")
            let speechSupported = await SpeechTranscriber.supportedLocales.map { $0.identifier(.bcp47) }.sorted()
            let speechInstalled = await SpeechTranscriber.installedLocales.map { $0.identifier(.bcp47) }.sorted()
            let dictationSupported = await DictationTranscriber.supportedLocales.map { $0.identifier(.bcp47) }.sorted()
            let dictationInstalled = await DictationTranscriber.installedLocales.map { $0.identifier(.bcp47) }.sorted()
            let speechEquivalent = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
            let dictationEquivalent = await DictationTranscriber.supportedLocale(equivalentTo: locale)
            var output: [String: Any] = [
                "speechAvailable": SpeechTranscriber.isAvailable,
                "speechSupported": speechSupported, "speechInstalled": speechInstalled,
                "dictationSupported": dictationSupported, "dictationInstalled": dictationInstalled,
                "speechEquivalent": speechEquivalent?.identifier(.bcp47) ?? NSNull(),
                "dictationEquivalent": dictationEquivalent?.identifier(.bcp47) ?? NSNull(),
                "downloadsRequested": false,
            ]
            if let selected = speechEquivalent {
                let module = SpeechTranscriber(locale: selected, preset: .transcription)
                output["speechZhAssetStatus"] = String(describing: await AssetInventory.status(forModules: [module]))
                let minimal = SpeechTranscriber(locale: selected, transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
                output["speechZhMinimalAssetStatus"] = String(describing: await AssetInventory.status(forModules: [minimal]))
            }
            if let selected = dictationEquivalent {
                let module = DictationTranscriber(locale: selected, preset: .longDictation)
                output["dictationZhAssetStatus"] = String(describing: await AssetInventory.status(forModules: [module]))
                let minimal = DictationTranscriber(locale: selected, contentHints: [], transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
                output["dictationZhMinimalAssetStatus"] = String(describing: await AssetInventory.status(forModules: [minimal]))
            }
            output["reservedLocales"] = await AssetInventory.reservedLocales.map { $0.identifier(.bcp47) }.sorted()
            let data = try! JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
            print(String(decoding: data, as: UTF8.self))
        } else {
            print("{\"unsupportedOS\":true,\"downloadsRequested\":false}")
        }
    }
}
