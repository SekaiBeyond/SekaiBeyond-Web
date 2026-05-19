import { setGlobalOptions } from "firebase-functions/v2";

// Enforce App Check on all functions globally
setGlobalOptions({enforceAppCheck: true});

export * from "./functions/users";
export * from "./functions/events";
export * from "./functions/badges";
export * from "./functions/codes";
export * from "./functions/tickets";
export * from "./functions/admin";
export { scheduledMailDrain } from "./functions/scheduledMail";
