"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Stack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { AstryxRoot } from "@/components/astryx/astryx-root";

export type RiskBannerView = {
  status: "error" | "info" | "warning";
  title: string;
  description: string;
};

export type RiskLimitView = {
  label: string;
  /** Texto já formatado: "R$ 12,00". */
  usedText: string;
  /** Texto já formatado ou "sem limite". */
  limitText: string;
  used: number;
  limit: number | null;
  reached: boolean;
  /** "folga de R$ 3,00", "restam 2" ou null. */
  roomText: string | null;
  note?: string;
};

export type RiskPauseView = { active: boolean; text: string };

/** Painel de risco (banner de estado + limites do perfil) no piloto do Astryx. */
export function RiskPanel({
  banner,
  limits,
  pause,
}: {
  banner: RiskBannerView;
  limits: RiskLimitView[];
  pause: RiskPauseView;
}) {
  return (
    <AstryxRoot>
      <Stack gap={4}>
        <Banner status={banner.status} title={banner.title} description={banner.description} />
        <List header="Limites do perfil">
          {limits.map((limit) => (
            <ListItem
              key={limit.label}
              label={
                <Stack gap={1}>
                  <Text>{limit.label}</Text>
                  <Text hasTabularNumbers weight={limit.reached ? "semibold" : "normal"}>
                    {limit.usedText} de {limit.limitText}
                    {limit.reached ? " · limite atingido" : limit.roomText ? ` · ${limit.roomText}` : ""}
                  </Text>
                  {limit.limit !== null && (
                    <ProgressBar
                      label={limit.label}
                      isLabelHidden
                      value={Math.min(limit.used, limit.limit)}
                      max={limit.limit}
                      variant={limit.reached ? "error" : "accent"}
                    />
                  )}
                  {limit.note && <Text type="supporting">{limit.note}</Text>}
                </Stack>
              }
            />
          ))}
          <ListItem
            label={
              <Stack gap={1}>
                <Text>Pausa após o limite mensal</Text>
                <Text hasTabularNumbers weight={pause.active ? "semibold" : "normal"}>
                  {pause.text}
                </Text>
              </Stack>
            }
          />
        </List>
      </Stack>
    </AstryxRoot>
  );
}
