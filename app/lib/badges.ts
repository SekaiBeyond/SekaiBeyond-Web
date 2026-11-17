import type { DocumentData } from 'firebase/firestore';
import { toDate } from './collectionCache';

export interface BadgeDef {
    id: string;
    name: string;
    nameCn: string;
    description: string;
    descriptionCn: string;
    imageUrl: string;
    createdByUid: string;
    createdByName: string;
    createdByLink: string;
    deleteAt: Date | null;
}

export const toBadgeDef = (docSnap: {id: string; data: () => DocumentData}): BadgeDef => {
    const data = docSnap.data();
    return {
        id: docSnap.id,
        name: data.name ?? '',
        nameCn: data.nameCn ?? '',
        description: data.description ?? '',
        descriptionCn: data.descriptionCn ?? '',
        imageUrl: data.imageUrl ?? '',
        createdByUid: data.createdByUid ?? '',
        createdByName: data.createdByName ?? '',
        createdByLink: data.createdByLink ?? '',
        deleteAt: toDate(data.deleteAt),
    };
};
