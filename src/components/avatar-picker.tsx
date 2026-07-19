import { useState } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export const AVATARS = [
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Milo",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Luna",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Oliver",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Maya",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Leo",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Zoe",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Jack",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Lily",
];

interface AvatarPickerProps {
  currentAvatar?: string;
  onSelect: (avatar: string) => void;
}

export function AvatarPicker({ currentAvatar, onSelect }: AvatarPickerProps) {
  return (
    <div className="grid grid-cols-5 gap-3 p-1">
      {AVATARS.map((avatar) => (
        <button
          key={avatar}
          type="button"
          onClick={() => onSelect(avatar)}
          className={cn(
            "relative group aspect-square rounded-2xl overflow-hidden border-2 transition-all duration-200 hover:scale-105 active:scale-95",
            currentAvatar === avatar 
              ? "border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]" 
              : "border-white/10 hover:border-white/20"
          )}
        >
          <img 
            src={avatar} 
            alt="Avatar Option" 
            className="w-full h-full object-cover"
          />
          {currentAvatar === avatar && (
            <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center backdrop-blur-[1px]">
              <div className="bg-amber-500 text-black rounded-full p-0.5 shadow-lg">
                <Check className="h-3 w-3" />
              </div>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
