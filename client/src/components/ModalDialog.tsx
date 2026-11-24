import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import './ModalDialog.css';

interface ModalDialogProps {
    open: boolean;
    onClose: () => void;
    title: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({ open, onClose, title, className = '', children }) => {
    const dialogRef = useRef<HTMLDialogElement | null>(null);
    const titleId = useId();
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (open) {
            if (!dialog.open) {
                dialog.showModal();
            }
        } else if (dialog.open) {
            dialog.close();
        }
    }, [open]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const handleClose = () => {
            dialog.returnValue = '';
            onCloseRef.current();
        };

        dialog.addEventListener('close', handleClose);

        // Fallback for browsers without native closedBy light-dismiss support
        let cleanupFallback: (() => void) | undefined;
        if (!('closedBy' in HTMLDialogElement.prototype)) {
            let pressedOutside = false;
            const isOutside = (e: PointerEvent) => {
                const r = dialog.getBoundingClientRect();
                return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
            };
            const onPointerDown = (e: PointerEvent) => {
                pressedOutside = e.target === dialog && isOutside(e);
            };
            const onPointerUp = (e: PointerEvent) => {
                if (pressedOutside && e.target === dialog && isOutside(e)) {
                    dialog.close();
                }
                pressedOutside = false;
            };
            dialog.addEventListener('pointerdown', onPointerDown);
            dialog.addEventListener('pointerup', onPointerUp);
            cleanupFallback = () => {
                dialog.removeEventListener('pointerdown', onPointerDown);
                dialog.removeEventListener('pointerup', onPointerUp);
            };
        }

        return () => {
            dialog.removeEventListener('close', handleClose);
            cleanupFallback?.();
        };
    }, []);

    return (
        <dialog
            ref={dialogRef}
            {...({ closedby: 'any' } as Record<string, string>)}
            aria-labelledby={titleId}
            className={`truco-native-dialog glass-panel ${className}`}
        >
            <div className="truco-native-dialog__header">
                <h1 id={titleId} className="truco-native-dialog__title">{title}</h1>
                <button
                    type="button"
                    className="truco-native-dialog__close"
                    aria-label="Close dialog"
                    onClick={() => dialogRef.current?.close()}
                >
                    <X size={18} />
                </button>
            </div>
            <div className="truco-native-dialog__body">
                {children}
            </div>
        </dialog>
    );
};
