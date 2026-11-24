import React, { useCallback, useEffect, useState } from 'react';
import { ShoppingBag, Check, Lock } from 'lucide-react';
import { getApiBaseUrl } from '../lib/apiBaseUrl';
import { ModalDialog } from './ModalDialog';
import './ShopModal.css';

export interface ShopItem {
    id: string;
    category: 'felt' | 'cardBack' | 'title';
    name: string;
    description: string;
    price: number;
    preview: string;
}

export interface EquippedCosmetics {
    felt: string;
    cardBack: string;
    title: string;
}

const LOCAL_FELT_STORAGE_KEY = 'truco_equipped_felt';

export function getStoredFeltTheme(): string {
    if (typeof window === 'undefined') return 'felt_emerald';
    try {
        return window.localStorage.getItem(LOCAL_FELT_STORAGE_KEY) || 'felt_emerald';
    } catch {
        return 'felt_emerald';
    }
}

export function setStoredFeltTheme(feltId: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(LOCAL_FELT_STORAGE_KEY, feltId);
        window.dispatchEvent(new CustomEvent('truco-cosmetics-updated', { detail: { felt: feltId } }));
    } catch {
        // ignore storage errors
    }
}

interface ShopModalProps {
    open: boolean;
    onClose: () => void;
    isAuthenticated: boolean;
    onBalanceChanged?: () => void;
}

export const ShopModal: React.FC<ShopModalProps> = ({ open, onClose, isAuthenticated, onBalanceChanged }) => {
    const [catalog, setCatalog] = useState<ShopItem[]>([]);
    const [bucksBalance, setBucksBalance] = useState<number>(0);
    const [ownedItems, setOwnedItems] = useState<string[]>(['felt_emerald', 'back_slate', 'title_rookie']);
    const [equipped, setEquipped] = useState<EquippedCosmetics>({
        felt: getStoredFeltTheme(),
        cardBack: 'back_slate',
        title: 'title_rookie',
    });
    const [activeTab, setActiveTab] = useState<'felt' | 'cardBack' | 'title'>('felt');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    const loadData = useCallback(async () => {
        const base = getApiBaseUrl();
        try {
            const catRes = await fetch(`${base}/api/economy/shop`, { credentials: 'include' });
            if (catRes.ok) {
                setCatalog(await catRes.json() as ShopItem[]);
            }
            if (isAuthenticated) {
                const profRes = await fetch(`${base}/api/economy/profile`, { credentials: 'include' });
                if (profRes.ok) {
                    const prof = await profRes.json() as {
                        bucksBalance: number;
                        ownedItems?: string[];
                        equipped?: EquippedCosmetics;
                    };
                    setBucksBalance(prof.bucksBalance);
                    if (prof.ownedItems) setOwnedItems(prof.ownedItems);
                    if (prof.equipped) {
                        setEquipped(prof.equipped);
                        setStoredFeltTheme(prof.equipped.felt);
                    }
                }
            }
        } catch {
            // ignore offline error
        }
    }, [isAuthenticated]);

    useEffect(() => {
        if (open) {
            setFeedback(null);
            void loadData();
        }
    }, [open, loadData]);

    const handleBuyOrEquip = async (item: ShopItem) => {
        const isOwned = item.price === 0 || ownedItems.includes(item.id);
        if (!isAuthenticated) {
            setFeedback({ type: 'err', text: 'Sign in with an account to unlock & equip Bucks cosmetics!' });
            return;
        }

        setBusyId(item.id);
        setFeedback(null);
        try {
            const base = getApiBaseUrl();
            const endpoint = isOwned ? '/api/economy/shop/equip' : '/api/economy/shop/buy';
            const res = await fetch(`${base}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ itemId: item.id }),
            });
            const data = await res.json();
            if (!res.ok) {
                setFeedback({ type: 'err', text: data.error || 'Action failed' });
                return;
            }
            const nextProfile = data.profile;
            if (nextProfile) {
                setBucksBalance(nextProfile.bucksBalance);
                if (nextProfile.ownedItems) setOwnedItems(nextProfile.ownedItems);
                if (nextProfile.equipped) {
                    setEquipped(nextProfile.equipped);
                    setStoredFeltTheme(nextProfile.equipped.felt);
                }
            }
            setFeedback({
                type: 'ok',
                text: isOwned ? `Equipped ${item.name}!` : `Unlocked & equipped ${item.name}!`,
            });
            onBalanceChanged?.();
        } catch {
            setFeedback({ type: 'err', text: 'Network error contacting shop' });
        } finally {
            setBusyId(null);
        }
    };

    const filtered = catalog.filter((item) => item.category === activeTab);

    return (
        <ModalDialog
            open={open}
            onClose={onClose}
            title={<><ShoppingBag size={20} /> Bucks Cosmetic Shop</>}
        >
            <div className="shop-topbar">
                <div className="shop-tabs">
                    <button
                        type="button"
                        className={`shop-tab ${activeTab === 'felt' ? 'active' : ''}`}
                        onClick={() => setActiveTab('felt')}
                    >
                        🎨 Table Felts
                    </button>
                    <button
                        type="button"
                        className={`shop-tab ${activeTab === 'cardBack' ? 'active' : ''}`}
                        onClick={() => setActiveTab('cardBack')}
                    >
                        🃏 Card Backs
                    </button>
                    <button
                        type="button"
                        className={`shop-tab ${activeTab === 'title' ? 'active' : ''}`}
                        onClick={() => setActiveTab('title')}
                    >
                        👑 Titles
                    </button>
                </div>
                <div className="shop-wallet-pill">
                    🪙 <strong>{isAuthenticated ? bucksBalance.toLocaleString() : 'Guest'}</strong> {isAuthenticated ? 'Bucks' : ''}
                </div>
            </div>

            {!isAuthenticated && (
                <div className="shop-guest-banner">
                    Sign in on the Lobby to earn Starter Bucks (1,000 🪙) and unlock custom felts, card backs, and titles!
                </div>
            )}

            {feedback && (
                <div className={`shop-feedback shop-feedback--${feedback.type}`}>
                    {feedback.text}
                </div>
            )}

            <div className="shop-grid">
                {filtered.map((item) => {
                    const isOwned = item.price === 0 || ownedItems.includes(item.id);
                    const isEquipped = equipped[item.category] === item.id;
                    return (
                        <div key={item.id} className={`shop-card ${isEquipped ? 'equipped' : ''}`}>
                            <div
                                className="shop-card__swatch"
                                style={item.category === 'title' ? undefined : { background: item.preview }}
                            >
                                {item.category === 'title' ? (
                                    <span className="shop-card__emoji">{item.preview}</span>
                                ) : item.category === 'cardBack' ? (
                                    <span className="shop-card__deck-icon">♠</span>
                                ) : (
                                    <span className="shop-card__felt-label">FELT</span>
                                )}
                            </div>
                            <div className="shop-card__info">
                                <div className="shop-card__name">{item.name}</div>
                                <div className="shop-card__desc">{item.description}</div>
                            </div>
                            <button
                                type="button"
                                className={`btn ${isEquipped ? 'btn-secondary' : 'btn-primary'} shop-card__btn`}
                                disabled={isEquipped || busyId === item.id}
                                onClick={() => void handleBuyOrEquip(item)}
                            >
                                {isEquipped ? (
                                    <><Check size={14} /> Equipped</>
                                ) : isOwned ? (
                                    'Equip'
                                ) : (
                                    <><Lock size={13} /> {item.price} 🪙</>
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>
        </ModalDialog>
    );
};
