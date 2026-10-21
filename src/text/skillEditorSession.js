import { cloneSkill } from "./skillContract.js";
import { BUILTIN_SKILLS } from "./builtinSkills.js";
import { scenarioFor } from "./skillScenarios.js";

// Kept by App for the current window session only. Drafts and trial text may
// contain private content, so this state must not be written to persistent storage.
export function createSkillEditorSession(selectedSkillId) {
  const viewedId = selectedSkillId || BUILTIN_SKILLS[0].id;
  return {
    viewedId,
    draft: null,
    sampleText: scenarioFor(BUILTIN_SKILLS.find((skill) => skill.id === viewedId)).input,
    revision: 0,
    pendingOperation: null,
  };
}

function changedSession(session, changes) {
  return { ...session, ...changes, revision: (session.revision ?? 0) + 1 };
}

export function skillEditorSessionReducer(session, action) {
  switch (action.type) {
    case "select":
      return changedSession(session, { viewedId: action.skill.id, draft: null, sampleText: scenarioFor(action.skill).input });
    case "edit":
      return changedSession(session, { draft: cloneSkill(action.draft) });
    case "draft-field":
      return session.draft ? changedSession(session, { draft: { ...session.draft, [action.field]: action.value } }) : session;
    case "sample":
      return changedSession(session, { sampleText: action.value });
    case "operation-started":
      return session.pendingOperation ? session : { ...session, pendingOperation: action.operation };
    case "operation-succeeded": {
      if (session.pendingOperation !== action.operation) return session;
      // A navigation round-trip can remount the editor while this request is
      // pending. Only finish the exact version that was submitted; later input
      // and explicitly replaced drafts belong to the user, not this response.
      if ((session.revision ?? 0) !== action.operation.revision) return { ...session, pendingOperation: null };
      if (action.operation.kind === "save") {
        return changedSession(session, { viewedId: action.skill.id, draft: null, pendingOperation: null });
      }
      const fallback = BUILTIN_SKILLS[0];
      return changedSession(session, { viewedId: fallback.id, draft: null, sampleText: scenarioFor(fallback).input, pendingOperation: null });
    }
    case "operation-finished":
      return session.pendingOperation === action.operation ? { ...session, pendingOperation: null } : session;
    default:
      return session;
  }
}
