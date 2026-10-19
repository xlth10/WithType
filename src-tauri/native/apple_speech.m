#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <dispatch/dispatch.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

// Each callback owns only its state. It never borrows a Rust allocation or the
// opaque handle, so callbacks arriving after cancellation/release stay valid.
@interface WTAppleSpeechState : NSObject
@property(nonatomic, strong) NSDictionary *result;
@end
@implementation WTAppleSpeechState
@end

@interface WTAppleSpeechHandle : NSObject
@property(nonatomic, strong) WTAppleSpeechState *state;
@property(nonatomic, strong) SFSpeechRecognizer *recognizer;
@property(nonatomic, strong) SFSpeechRecognitionTask *task;
@end
@implementation WTAppleSpeechHandle
@end

static char *WTJSON(NSDictionary *object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    if (!data) return strdup("{\"error\":\"Apple 语音识别返回了无效结果\"}");
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return strdup(json.UTF8String);
}

static NSString *WTLocale(const char *value) {
    NSString *locale = value ? [NSString stringWithUTF8String:value] : nil;
    return locale.length ? [locale stringByReplacingOccurrencesOfString:@"_" withString:@"-"] : @"zh-CN";
}

static NSString *WTAuthorization(SFSpeechRecognizerAuthorizationStatus status) {
    switch (status) {
        case SFSpeechRecognizerAuthorizationStatusAuthorized: return @"authorized";
        case SFSpeechRecognizerAuthorizationStatusDenied: return @"denied";
        case SFSpeechRecognizerAuthorizationStatusRestricted: return @"restricted";
        default: return @"notDetermined";
    }
}

static NSArray<NSString *> *WTSupportedLocales(void) {
    NSMutableArray<NSString *> *locales = [NSMutableArray array];
    for (NSLocale *locale in SFSpeechRecognizer.supportedLocales) {
        [locales addObject:[locale.localeIdentifier stringByReplacingOccurrencesOfString:@"_" withString:@"-"]];
    }
    return [locales sortedArrayUsingSelector:@selector(compare:)];
}

char *withtype_apple_speech_status(const char *localeValue, bool requestAuthorization) {
    @autoreleasepool {
        SFSpeechRecognizerAuthorizationStatus auth = SFSpeechRecognizer.authorizationStatus;
        if (requestAuthorization && auth == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
            dispatch_semaphore_t completed = dispatch_semaphore_create(0);
            // No stack pointer escapes: the copied block retains the semaphore.
            dispatch_async(dispatch_get_main_queue(), ^{
                [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
                    (void)status;
                    dispatch_semaphore_signal(completed);
                }];
            });
            if (dispatch_semaphore_wait(completed, dispatch_time(DISPATCH_TIME_NOW, 120LL * NSEC_PER_SEC)) != 0) {
                return WTJSON(@{@"error": @"等待 Apple 语音识别授权超时，请授权后重试"});
            }
            auth = SFSpeechRecognizer.authorizationStatus;
        }
        NSString *locale = WTLocale(localeValue);
        NSArray<NSString *> *supported = WTSupportedLocales();
        BOOL localeSupported = [supported containsObject:locale];
        SFSpeechRecognizer *recognizer = localeSupported
            ? [[SFSpeechRecognizer alloc] initWithLocale:[[NSLocale alloc] initWithLocaleIdentifier:locale]]
            : nil;
        return WTJSON(@{
            @"platformSupported": @YES,
            @"authorization": WTAuthorization(auth),
            // C's && has type int. Boxing it with @(...) serializes 0/1,
            // which is not a JSON Boolean and cannot decode into Rust bool.
            @"available": (recognizer != nil && recognizer.isAvailable) ? @YES : @NO,
            @"supportsOnDeviceRecognition": (recognizer != nil && recognizer.supportsOnDeviceRecognition) ? @YES : @NO,
            @"locale": locale,
            @"supportedLocales": supported,
        });
    }
}

void *withtype_apple_speech_start(const char *pathValue, const char *localeValue) {
    @autoreleasepool {
        WTAppleSpeechHandle *handle = [WTAppleSpeechHandle new];
        WTAppleSpeechState *state = [WTAppleSpeechState new];
        handle.state = state;
        NSString *locale = WTLocale(localeValue);
        if (SFSpeechRecognizer.authorizationStatus != SFSpeechRecognizerAuthorizationStatusAuthorized) {
            state.result = @{@"error": @"尚未获得 Apple 语音识别权限，请在系统设置中允许 WithType 使用语音识别"};
            return (__bridge_retained void *)handle;
        }
        if (![WTSupportedLocales() containsObject:locale]) {
            state.result = @{@"error": [NSString stringWithFormat:@"Apple 语音识别不支持语言 %@", locale]};
            return (__bridge_retained void *)handle;
        }
        SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:[[NSLocale alloc] initWithLocaleIdentifier:locale]];
        handle.recognizer = recognizer;
        if (!recognizer || !recognizer.supportsOnDeviceRecognition) {
            state.result = @{@"error": @"当前语言的 Apple 设备端识别不可用，请在系统设置的听写中添加该语言并完成资源下载后重试；本次不会改用联网识别"};
            return (__bridge_retained void *)handle;
        }
        if (!recognizer.isAvailable) {
            state.result = @{@"error": @"Apple 语音识别当前不可用，请检查系统听写语言资源后重试"};
            return (__bridge_retained void *)handle;
        }
        NSString *path = pathValue ? [NSString stringWithUTF8String:pathValue] : nil;
        if (!path.length) {
            state.result = @{@"error": @"Apple 语音识别录音路径无效"};
            return (__bridge_retained void *)handle;
        }
        SFSpeechURLRecognitionRequest *request = [[SFSpeechURLRecognitionRequest alloc] initWithURL:[NSURL fileURLWithPath:path]];
        request.requiresOnDeviceRecognition = YES;
        request.shouldReportPartialResults = NO;
        request.addsPunctuation = YES;
        request.taskHint = SFSpeechRecognitionTaskHintDictation;
        // Rust waits on a blocking worker, while the app's main run loop remains
        // available for Speech's callbacks and system permission panels.
        handle.task = [recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
            @synchronized (state) {
                if (state.result) return;
                if (result.isFinal) {
                    state.result = @{@"text": result.bestTranscription.formattedString ?: @""};
                } else if (error) {
                    NSString *detail = error.localizedDescription ?: @"未知错误";
                    state.result = @{@"error": [NSString stringWithFormat:@"Apple 设备端语音识别失败：%@（%@ %ld）", detail, error.domain, (long)error.code]};
                }
            }
        }];
        return (__bridge_retained void *)handle;
    }
}

char *withtype_apple_speech_poll(void *opaque) {
    @autoreleasepool {
        WTAppleSpeechHandle *handle = (__bridge WTAppleSpeechHandle *)opaque;
        @synchronized (handle.state) {
            return handle.state.result ? WTJSON(handle.state.result) : NULL;
        }
    }
}

void withtype_apple_speech_cancel(void *opaque) {
    @autoreleasepool {
        WTAppleSpeechHandle *handle = (__bridge WTAppleSpeechHandle *)opaque;
        @synchronized (handle.state) {
            if (!handle.state.result) handle.state.result = @{@"error": @"录音已取消"};
        }
        [handle.task cancel];
    }
}

void withtype_apple_speech_release(void *opaque) {
    @autoreleasepool {
        WTAppleSpeechHandle *handle = (__bridge_transfer WTAppleSpeechHandle *)opaque;
        (void)handle;
    }
}

void withtype_apple_speech_free(char *value) { free(value); }
