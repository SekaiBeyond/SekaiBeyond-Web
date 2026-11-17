import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';

export function useLoaded<T>(key: string | null, load: (key: string) => Promise<T>): {
    data: T | null;
    failed: boolean;
    setData: Dispatch<SetStateAction<T | null>>;
} {
    const [data, setData] = useState<T | null>(null);
    const [failed, setFailed] = useState(false);
    const loadRef = useRef(load);
    loadRef.current = load;

    useEffect(() => {
        setData(null);
        setFailed(false);
        if (key === null) return;
        let stale = false;
        loadRef.current(key)
            .then(value => {
                if (!stale) setData(value);
            })
            .catch(() => {
                if (!stale) setFailed(true);
            });
        return () => {
            stale = true;
        };
    }, [key]);

    return {data, failed, setData};
}
