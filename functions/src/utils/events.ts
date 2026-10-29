import { db } from "./firebase";

/**
 * An event's doc from whichever collection holds it: upcomingEvents, or
 * pastEvents once archived, which keeps the ID. Archiving refuses an ID a past
 * event already has, so the two never both hold one. `snap` doesn't exist when
 * neither does.
 */
export async function getEventInTxn(
    txn: FirebaseFirestore.Transaction,
    eventId: string,
): Promise<{snap: FirebaseFirestore.DocumentSnapshot; archived: boolean}> {
    const [upcoming, past] = await Promise.all([
        txn.get(db.collection("upcomingEvents").doc(eventId)),
        txn.get(db.collection("pastEvents").doc(eventId)),
    ]);
    return upcoming.exists ? {snap: upcoming, archived: false} : {snap: past, archived: true};
}
