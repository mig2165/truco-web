import React, { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { ChangelogModal } from './ChangelogModal';

interface ChangelogLauncherProps {
    className?: string;
    label?: string;
}

export const ChangelogLauncher: React.FC<ChangelogLauncherProps> = ({
    className = '',
    label = 'View Changelog',
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                className={className}
                onClick={() => setIsOpen(true)}
            >
                <ScrollText size={18} />
                {label}
            </button>
            <ChangelogModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
};
