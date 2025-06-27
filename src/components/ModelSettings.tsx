"use client";

import { useModelConfig } from "@/hooks/useModelConfig";
import { useRagModelConfig } from "@/hooks/useRagModelConfig";
import { useDetailModelConfig } from "@/hooks/useDetailModelConfig";
import { useState, useEffect } from "react";

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

export interface ModelSetting {
  provider: string;
  model: string;
  temperature: number;
  top_p: number;
}

export default function ModelSettings({
  onChange,
  context = "papers",     // "papers" or "rag" or "paper_detail"
  disabled=false,
}: {
  onChange: (m: ModelSetting) => void;
  context?: "papers" | "rag" | "paper_detail";
  disabled?: boolean;
}) {
  // Hooks must be called at the top level, not conditionally
  const ragConfig = useRagModelConfig();
  const paperConfig = useModelConfig();
  const detailConfig = useDetailModelConfig();
  const { data } = context === "rag" ? ragConfig : 
                  context === "paper_detail" ? detailConfig : 
                  paperConfig;
  const [state, setState] = useState<ModelSetting | undefined>(undefined);

  useEffect(() => {
    if (data && !state) {
      const prov = data.default_model.provider;
      const mdl = data.default_model.model_name;
      const rng = data.models[mdl];
      if (!rng) return;
      const initial: ModelSetting = {
        provider: prov,
        model: mdl,
        temperature: Number(rng.temperature_range[0]),
        top_p: Number(rng.top_p_range[0]),
      };
      setState(initial);
      onChange(initial);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (state) {
      onChange(state);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!data || !state) return null;

  const update = (patch: Partial<ModelSetting>) => {
    setState((prev) => {
      if (!prev) return prev;
      return { ...prev, ...patch };
    });
  };

  const rng = data.models[state.model]!;

  return (
    <div className="space-y-3">
      <div className="grid gap-1">
        <Label>プロバイダ</Label>
        <Select
          value={state.provider}
          onValueChange={(pv) => {
            const mdl = data.default_models_by_provider[pv];
            const r = data.models[mdl];
            if (!r) return;
            update({
              provider: pv,
              model: mdl,
              temperature: Number(r.temperature_range[0]),
              top_p: Number(r.top_p_range[0]),
            });
          }}
        >
          <SelectTrigger disabled={disabled} className="w-full overflow-hidden">
            <SelectValue placeholder="Select provider" className="truncate w-full" />
          </SelectTrigger>
          <SelectContent className="w-[var(--radix-select-trigger-width)]">
            {Object.keys(data.default_models_by_provider).map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1">
        <Label>モデル</Label>
        <Select
          value={state.model}
          onValueChange={(m) => {
            const r = data.models[m];
            if (!r) return;
            update({
              model: m,
              temperature: Number(r.temperature_range[0]),
              top_p: Number(r.top_p_range[0]),
            });
          }}
        >
          <SelectTrigger disabled={disabled} className="w-full overflow-hidden">
            <SelectValue placeholder="Select model" className="truncate w-full" />
          </SelectTrigger>
          <SelectContent className="w-[var(--radix-select-trigger-width)]">
            {Object.entries(data.models)
              .filter(([, v]) => v.provider === state.provider)
              .map(([m]) => (
                <SelectItem key={m} value={m}>
                  {m.includes("::") ? m.split("::")[1] : m}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1">
        <Label>Temperature: {state.temperature.toFixed(4)}</Label>
        <Slider
          disabled={disabled}
          value={[state.temperature]}
          min={Number(rng.temperature_range[0])}
          max={Number(rng.temperature_range[1])}
          step={(Number(rng.temperature_range[1]) - Number(rng.temperature_range[0])) / 100}
          onValueChange={([v]) => update({ temperature: v })}
        />
      </div>

      <div className="grid gap-1">
        <Label>Top-P: {state.top_p.toFixed(4)}</Label>
        <Slider
          disabled={disabled}
          value={[state.top_p]}
          min={Number(rng.top_p_range[0])}
          max={Number(rng.top_p_range[1])}
          step={(Number(rng.top_p_range[1]) - Number(rng.top_p_range[0])) / 100}
          onValueChange={([v]) => update({ top_p: v })}
        />
      </div>
    </div>
  );
}
