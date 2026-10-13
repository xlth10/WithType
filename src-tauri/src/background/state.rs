//! Pure lifecycle decisions. No window, network, or audio effects occur here.
use std::collections::{HashMap, HashSet, VecDeque};

pub const HEARTBEAT_TIMEOUT: u64 = 30_000;
pub const STARTUP_TIMEOUT: u64 = 60_000;
pub const COMMAND_TIMEOUT: u64 = 4_000;
const DIALOG_TIMEOUT: u64 = 600_000;
const RECOVERY_WINDOW: u64 = 300_000;
const MAX_RECOVERIES: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Phase {
    Starting,
    Ready,
    Recovering,
    Suspended,
    Failed,
    Stopped,
}
impl Phase {
    pub fn label(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Ready => "ready",
            Self::Recovering => "recovering",
            Self::Suspended => "suspended",
            Self::Failed => "failed",
            Self::Stopped => "stopped",
        }
    }
}

pub struct Machine {
    pub generation: u64,
    pub phase: Phase,
    pub message: String,
    pub last_seen: u64,
    pub since: u64,
    pub sleeping: bool,
    pub locked: bool,
    pub tasks: HashSet<String>,
    sequence: u64,
    commands: HashMap<u64, u64>,
    recoveries: VecDeque<u64>,
    dialog_until: Option<u64>,
}
impl Default for Machine {
    fn default() -> Self {
        Self {
            generation: 1,
            phase: Phase::Starting,
            message: String::new(),
            last_seen: 0,
            since: 0,
            sleeping: false,
            locked: false,
            tasks: HashSet::new(),
            sequence: 0,
            commands: HashMap::new(),
            recoveries: VecDeque::new(),
            dialog_until: None,
        }
    }
}
impl Machine {
    pub fn ready(&mut self, generation: u64, now: u64) -> bool {
        if generation != self.generation
            || self.sleeping
            || self.locked
            || matches!(self.phase, Phase::Failed | Phase::Stopped)
        {
            return false;
        }
        self.phase = Phase::Ready;
        self.last_seen = now;
        true
    }
    pub fn pong(&mut self, generation: u64, now: u64) -> bool {
        if generation != self.generation || self.phase == Phase::Stopped {
            return false;
        }
        self.last_seen = now;
        true
    }
    pub fn issue(&mut self, now: u64) -> Option<u64> {
        if self.phase != Phase::Ready || self.dialog_until.is_some() || self.commands.len() >= 8 {
            return None;
        }
        self.sequence += 1;
        self.commands.insert(self.sequence, now);
        Some(self.sequence)
    }
    pub fn claim(&mut self, generation: u64, id: u64, now: u64) -> bool {
        if generation != self.generation || self.phase != Phase::Ready {
            return false;
        }
        // Leave an expired command visible to the watchdog, even if its late claim arrives first.
        if self
            .commands
            .get(&id)
            .is_some_and(|sent| now.saturating_sub(*sent) <= COMMAND_TIMEOUT)
        {
            self.commands.remove(&id);
            true
        } else {
            false
        }
    }
    pub fn track(&mut self, generation: u64, id: String) -> bool {
        if generation != self.generation || self.phase != Phase::Ready || self.tasks.len() >= 16 {
            return false;
        }
        self.tasks.insert(id);
        true
    }
    pub fn invalidate(&mut self, phase: Phase, now: u64, message: String) -> Vec<String> {
        self.generation += 1;
        self.phase = phase;
        self.message = message;
        self.since = now;
        self.last_seen = now;
        self.commands.clear(); // Never replay toggles or insertion commands after recovery.
        self.dialog_until = None;
        self.tasks.drain().collect()
    }
    pub fn recover(&mut self, now: u64, manual: bool) -> Option<Vec<String>> {
        if self.phase == Phase::Stopped || self.sleeping || self.locked {
            return None;
        }
        if manual {
            self.recoveries.clear();
        }
        while self
            .recoveries
            .front()
            .is_some_and(|time| now.saturating_sub(*time) >= RECOVERY_WINDOW)
        {
            self.recoveries.pop_front();
        }
        let phase = if self.recoveries.len() >= MAX_RECOVERIES {
            Phase::Failed
        } else {
            Phase::Recovering
        };
        let message = if phase == Phase::Failed {
            "语音输入暂时不可用，请从托盘选择「恢复语音输入」"
        } else {
            "语音输入已重新初始化；中断的录音可在历史页面恢复，请重新按快捷键"
        };
        if phase == Phase::Recovering {
            self.recoveries.push_back(now);
        }
        Some(self.invalidate(phase, now, message.into()))
    }
    pub fn timeout(&self, now: u64) -> bool {
        if !matches!(
            self.phase,
            Phase::Starting | Phase::Ready | Phase::Recovering
        ) {
            return false;
        }
        if self.dialog_until.is_some_and(|deadline| now <= deadline) {
            return false;
        }
        let limit = if self.phase == Phase::Ready {
            HEARTBEAT_TIMEOUT
        } else {
            STARTUP_TIMEOUT
        };
        now.saturating_sub(self.last_seen) > limit
            || (self.phase != Phase::Ready && now.saturating_sub(self.since) > STARTUP_TIMEOUT)
            || self
                .commands
                .values()
                .any(|sent| now.saturating_sub(*sent) > COMMAND_TIMEOUT)
    }
    pub fn dialog(&mut self, generation: u64, active: bool, now: u64) -> bool {
        if generation != self.generation || self.phase != Phase::Ready {
            return false;
        }
        self.dialog_until = if active {
            Some(now + DIALOG_TIMEOUT)
        } else {
            None
        };
        if !active {
            self.last_seen = now;
        }
        true
    }
    pub fn pause(&mut self, sleep: bool, paused: bool, now: u64) -> Option<Vec<String>> {
        if self.phase == Phase::Stopped {
            return None;
        }
        let flag = if sleep {
            &mut self.sleeping
        } else {
            &mut self.locked
        };
        if *flag == paused {
            return None;
        }
        *flag = paused;
        if self.sleeping || self.locked {
            if self.phase == Phase::Suspended {
                return None;
            }
            Some(self.invalidate(
                Phase::Suspended,
                now,
                "录音已因睡眠或锁屏中断，已有音频保留供恢复".into(),
            ))
        } else {
            Some(self.invalidate(
                Phase::Starting,
                now,
                "已从睡眠或锁屏恢复，请重新按快捷键录音".into(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_is_not_ready_and_claim_is_once_only() {
        let mut s = Machine::default();
        assert_eq!(s.issue(0), None);
        assert!(s.ready(1, 1));
        let id = s.issue(2).unwrap();
        assert!(s.claim(1, id, 3));
        assert!(!s.claim(1, id, 4));
    }
    #[test]
    fn old_page_cannot_reactivate_or_replay_after_recovery() {
        let mut s = Machine::default();
        s.ready(1, 0);
        let id = s.issue(1).unwrap();
        s.track(1, "task-1".into());
        assert_eq!(s.recover(2, false).unwrap(), vec!["task-1"]);
        assert!(!s.ready(1, 3));
        assert!(!s.pong(1, 3));
        assert!(!s.claim(1, id, 3));
        assert!(!s.track(1, "late".into()));
        assert!(s.ready(2, 3));
        assert!(!s.claim(2, id, 4));
    }
    #[test]
    fn unclaimed_command_expires_even_with_healthy_heartbeats() {
        let mut s = Machine::default();
        s.ready(1, 0);
        let id = s.issue(0).unwrap();
        s.pong(1, 4500);
        assert!(s.timeout(4500));
        assert!(!s.claim(1, id, 4500));
        assert!(s.timeout(4501));
    }
    #[test]
    fn failures_are_bounded_and_explicit_repair_resets_the_budget() {
        let mut s = Machine::default();
        for time in [1, 2, 3] {
            s.recover(time, false);
            assert_eq!(s.phase, Phase::Recovering);
        }
        s.recover(4, false);
        assert_eq!(s.phase, Phase::Failed);
        assert!(!s.timeout(999999));
        assert!(!s.ready(s.generation, 5));
        s.recover(6, true);
        assert_eq!(s.phase, Phase::Recovering);
    }
    #[test]
    fn responding_page_with_failed_initialization_does_not_wait_forever() {
        let mut s = Machine::default();
        s.pong(1, 60001);
        assert!(s.timeout(60001));
    }
    #[test]
    fn sleep_and_lock_are_independent_and_resume_is_not_a_dead_heartbeat() {
        let mut s = Machine::default();
        s.ready(1, 0);
        assert!(s.pause(true, true, 1).is_some());
        assert!(s.pause(true, true, 2).is_none());
        s.pause(false, true, 3);
        assert!(!s.timeout(999999));
        assert!(s.pause(true, false, 999999).is_none());
        assert_eq!(s.phase, Phase::Suspended);
        s.pause(false, false, 1_000_000);
        assert_eq!(s.phase, Phase::Starting);
        assert!(!s.timeout(1_000_001));
        assert!(s.ready(s.generation, 1_000_002));
    }
    #[test]
    fn exit_is_final_even_when_late_messages_arrive() {
        let mut s = Machine::default();
        s.invalidate(Phase::Stopped, 1, String::new());
        assert!(s.recover(2, true).is_none());
        assert!(s.pause(true, false, 3).is_none());
        assert!(!s.ready(s.generation, 4));
        assert!(!s.pong(s.generation, 4));
        assert!(!s.timeout(999999));
    }
    #[test]
    fn confirmation_dialog_has_a_bounded_hold_and_accepts_no_voice_actions() {
        let mut s = Machine::default();
        s.ready(1, 0);
        assert!(s.dialog(1, true, 1));
        assert!(!s.timeout(600_001));
        assert!(s.timeout(600_002));
        assert_eq!(s.issue(2), None);
        assert!(s.dialog(1, false, 600_003));
        assert!(!s.timeout(600_004));
        assert!(s.issue(600_004).is_some());
        s.recover(600_005, true);
        assert!(!s.dialog(1, false, 600_006));
    }
}
