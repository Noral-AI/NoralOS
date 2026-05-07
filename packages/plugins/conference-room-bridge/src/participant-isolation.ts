// Participant isolation for Conference Room sessions.
//
// Decides who owns a Conference Room session and which agent_task_sessions
// row its model state belongs to. The two cases:
//
// 1. Authenticated user actor (`actorType === 'user'` with a non-empty
//    `userId`): the participant is `userId` and the session routes to the
//    per-user task key. Same human across browser tabs/refreshes converges
//    on a single Claude session; different humans never share state.
//
// 2. Anything else (agent caller, anonymous board session, missing userId):
//    the participant is null and the session routes to a per-conference-
//    session anonymous task key. Each anonymous session is isolated from
//    every other and never inherits the agent's most recent global state.
//
// The body's legacy `participantId` is honoured only when there is no
// authenticated user actor; an authenticated actor is always trusted ahead
// of caller-provided body values.

import {
  ISOLATION_TASK_KEY_PREFIX_ANON,
  ISOLATION_TASK_KEY_PREFIX_USER,
} from "./constants.js";

export type IsolationKeyType = "user" | "anon";

export interface IsolationActor {
  actorType?: "user" | "agent";
  userId?: string | null;
}

export interface IsolationBody {
  participantId?: unknown;
}

export interface ParticipantContext {
  participantId: string | null;
  taskKey: string;
  isolationKeyType: IsolationKeyType;
}

export function deriveParticipantContext(
  actor: IsolationActor | undefined,
  body: IsolationBody,
  conferenceSessionId: string,
): ParticipantContext {
  const actorUserId =
    actor?.actorType === "user" && typeof actor.userId === "string" && actor.userId.length > 0
      ? actor.userId
      : null;
  if (actorUserId) {
    return {
      participantId: actorUserId,
      taskKey: `${ISOLATION_TASK_KEY_PREFIX_USER}${actorUserId}`,
      isolationKeyType: "user",
    };
  }
  const bodyParticipant =
    typeof body.participantId === "string" && body.participantId.length > 0
      ? body.participantId
      : null;
  return {
    participantId: bodyParticipant,
    taskKey: `${ISOLATION_TASK_KEY_PREFIX_ANON}${conferenceSessionId}`,
    isolationKeyType: "anon",
  };
}
