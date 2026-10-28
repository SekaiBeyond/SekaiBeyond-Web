import { setGlobalOptions } from "firebase-functions/v2";

// Off in the emulator only: the site skips App Check there, and a callable
// enforcing it refuses a request with no token even when emulated.
setGlobalOptions({enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true"});

export * from "./functions/users";
export * from "./functions/events";
export * from "./functions/badges";
export * from "./functions/codes";
export * from "./functions/tickets";
export * from "./functions/admin";
export * from "./functions/qrCodes";
export * from "./functions/passports";
export * from "./functions/passportEmails";
export * from "./functions/socialPlatforms";
export * from "./functions/apiKeys";
export { api } from "./functions/api";
export { scheduledMailDrain } from "./functions/scheduledMail";
export { lookUpUwBuilding, syncUwParking, uwParkingNightlySync } from "./functions/parking";
