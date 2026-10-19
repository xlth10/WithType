// A JSONL adapter for opt-in, repeatable Apple Speech measurements. This uses
// the exact app bridge, without access to app preferences, history or keyring.
#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>

extern char *withtype_apple_speech_status(const char *, bool);
extern void *withtype_apple_speech_start(const char *, const char *, const char *);
extern char *withtype_apple_speech_poll(void *);
extern void withtype_apple_speech_cancel(void *);
extern void withtype_apple_speech_release(void *);
extern void withtype_apple_speech_free(char *);

static NSDictionary *DecodeNative(char *value) {
    if (!value) return nil;
    NSData *data = [[NSString stringWithUTF8String:value] dataUsingEncoding:NSUTF8StringEncoding];
    withtype_apple_speech_free(value);
    id decoded = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    return [decoded isKindOfClass:NSDictionary.class] ? decoded : @{@"error": @"Apple bridge returned invalid JSON"};
}

static NSDictionary *RunCommand(NSDictionary *command) {
    NSDictionary *args = [command[@"args"] isKindOfClass:NSDictionary.class] ? command[@"args"] : @{};
    NSString *locale = [args[@"locale"] isKindOfClass:NSString.class] ? args[@"locale"] : @"zh-CN";
    if ([command[@"command"] isEqual:@"request_authorization"]) {
        // This command is deliberately separate from health and the benchmark
        // path. The human handles macOS's permission dialog; no TCC edits/UI
        // automation are used. Bound a diagnostic run to thirty seconds.
        if (SFSpeechRecognizer.authorizationStatus == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
            dispatch_semaphore_t completed = dispatch_semaphore_create(0);
            dispatch_async(dispatch_get_main_queue(), ^{
                [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
                    (void)status;
                    dispatch_semaphore_signal(completed);
                }];
            });
            if (dispatch_semaphore_wait(completed, dispatch_time(DISPATCH_TIME_NOW, 30LL * NSEC_PER_SEC)) != 0) {
                return @{@"error": @"Apple Speech authorization was not completed within 30 seconds; rerun after responding to the system dialog"};
            }
        }
        return DecodeNative(withtype_apple_speech_status(locale.UTF8String, false));
    }
    if ([command[@"command"] isEqual:@"health"]) {
        // Do not request authorization: unattended benchmarks must not open a
        // permission panel, nor turn notDetermined/denied into a passing run.
        NSMutableDictionary *status = [DecodeNative(withtype_apple_speech_status(locale.UTF8String, false)) mutableCopy];
        status[@"provider"] = @"apple";
        status[@"model"] = @"Apple on-device Speech";
        status[@"authorizationScope"] = @"probe process (independent of WithType; TCC attribution may include the launching host)";
        return status;
    }
    if (![command[@"command"] isEqual:@"transcribe_audio"]) {
        return @{@"error": @"Unsupported command; Apple probe supports health/transcribe_audio/request_authorization"};
    }
    NSDictionary *status = DecodeNative(withtype_apple_speech_status(locale.UTF8String, false));
    if (![status[@"authorization"] isEqual:@"authorized"]) {
        return @{@"error": [NSString stringWithFormat:@"Apple Speech probe authorization is %@; no ASR was attempted", status[@"authorization"] ?: @"unknown"]};
    }
    if (![status[@"supportsOnDeviceRecognition"] boolValue] || ![status[@"available"] boolValue]) {
        return @{@"error": @"Apple on-device Speech is unavailable for this locale; no network fallback was attempted"};
    }
    NSString *audioPath = [args[@"audioPath"] isKindOfClass:NSString.class] ? args[@"audioPath"] : nil;
    NSString *temporaryPath = nil;
    if (!audioPath && [args[@"audioBase64"] isKindOfClass:NSString.class]) {
        NSData *audio = [[NSData alloc] initWithBase64EncodedString:args[@"audioBase64"] options:0];
        if (!audio.length || audio.length > 16000 * 2 * 50 + 4096) return @{@"error": @"Probe requires a valid WAV fixture shorter than 50 seconds"};
        temporaryPath = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"withtype-probe-%@.wav", NSUUID.UUID.UUIDString]];
        if (![audio writeToFile:temporaryPath options:NSDataWritingAtomic error:nil]) return @{@"error": @"Could not create temporary fixture"};
        [[NSFileManager defaultManager] setAttributes:@{NSFilePosixPermissions: @0600} ofItemAtPath:temporaryPath error:nil];
        audioPath = temporaryPath;
    }
    if (!audioPath.isAbsolutePath || ![[NSFileManager defaultManager] isReadableFileAtPath:audioPath]) {
        return @{@"error": @"audioPath must name a readable absolute WAV file, or provide audioBase64"};
    }
    NSArray *hotWords = [args[@"hotWords"] isKindOfClass:NSArray.class] ? args[@"hotWords"] : @[];
    NSData *contextData = [NSJSONSerialization dataWithJSONObject:hotWords options:0 error:nil];
    NSString *contextJSON = contextData ? [[NSString alloc] initWithData:contextData encoding:NSUTF8StringEncoding] : @"[]";
    CFAbsoluteTime started = CFAbsoluteTimeGetCurrent();
    void *handle = withtype_apple_speech_start(audioPath.UTF8String, locale.UTF8String, contextJSON.UTF8String);
    NSDictionary *result = nil;
    if (!handle) result = @{@"error": @"Could not create Apple Speech task"};
    while (handle && !result && CFAbsoluteTimeGetCurrent() - started < 120) {
        result = DecodeNative(withtype_apple_speech_poll(handle));
        if (!result) usleep(40000);
    }
    if (handle) {
        withtype_apple_speech_cancel(handle);
        withtype_apple_speech_release(handle);
    }
    if (temporaryPath) [[NSFileManager defaultManager] removeItemAtPath:temporaryPath error:nil];
    if (!result) return @{@"error": @"Apple Speech probe timed out"};
    if (result[@"error"]) return result;
    return @{@"text": result[@"text"] ?: @"", @"durationMs": @((CFAbsoluteTimeGetCurrent() - started) * 1000)};
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 4 && strcmp(argv[1], "--jsonl") == 0) {
            struct stat inputInfo, outputInfo;
            if (stat(argv[2], &inputInfo) != 0 || stat(argv[3], &outputInfo) != 0 ||
                !S_ISFIFO(inputInfo.st_mode) || !S_ISFIFO(outputInfo.st_mode) ||
                !freopen(argv[2], "r", stdin) || !freopen(argv[3], "w", stdout)) {
                return 2;
            }
        }
        __block atomic_bool completed = false;
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            char *line = NULL;
            size_t capacity = 0;
            while (getline(&line, &capacity, stdin) != -1) {
                @autoreleasepool {
                    NSData *data = [[NSString stringWithUTF8String:line] dataUsingEncoding:NSUTF8StringEncoding];
                    id command = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
                    NSDictionary *result = [command isKindOfClass:NSDictionary.class] ? RunCommand(command) : @{@"error": @"Invalid JSONL command"};
                    id identifier = [command isKindOfClass:NSDictionary.class] ? command[@"id"] : nil;
                    NSDictionary *response = result[@"error"]
                        ? @{@"id": identifier ?: NSNull.null, @"ok": @NO, @"error": result[@"error"]}
                        : @{@"id": identifier ?: NSNull.null, @"ok": @YES, @"result": result ?: @{}};
                    NSData *encoded = [NSJSONSerialization dataWithJSONObject:response options:NSJSONWritingSortedKeys error:nil];
                    fwrite(encoded.bytes, 1, encoded.length, stdout);
                    fputc('\n', stdout);
                    fflush(stdout);
                }
            }
            free(line);
            atomic_store(&completed, true);
        });
        // Speech callbacks require the main run loop even for URL recognition.
        while (!atomic_load(&completed)) {
            [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.04]];
        }
    }
    return 0;
}
