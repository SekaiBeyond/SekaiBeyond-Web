import { db } from "./firebase";

/**
 * An event's doc from whichever collection holds it: upcomingEvents, or
 * pastEvents once archived, which keeps the ID. Archiving refuses an ID a past
 * event already has, so the two never both hold one. `snap` doesn't exist when
 * neither does. Read in `txn` when given one.
 */
export async function getEventDoc(
    eventId: string,
    txn?: FirebaseFirestore.Transaction,
): Promise<{snap: FirebaseFirestore.DocumentSnapshot; archived: boolean}> {
    const read = (ref: FirebaseFirestore.DocumentReference) => txn ? txn.get(ref) : ref.get();
    const [upcoming, past] = await Promise.all([
        read(db.collection("upcomingEvents").doc(eventId)),
        read(db.collection("pastEvents").doc(eventId)),
    ]);
    return upcoming.exists ? {snap: upcoming, archived: false} : {snap: past, archived: true};
}

