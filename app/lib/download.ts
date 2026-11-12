/** Hand a generated file to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    // Revoked on the next task so the click has already been dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
