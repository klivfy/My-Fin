"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrivacyMode } from "@/components/privacy-mode";

export function PrivacyToggle() {
  const { enabled, toggle } = usePrivacyMode();
  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className="size-10"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Desativar modo privacidade" : "Ativar modo privacidade"}
      title={enabled ? "Desativar modo privacidade" : "Ativar modo privacidade"}
    >
      {enabled ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
    </Button>
  );
}
