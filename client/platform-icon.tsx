import { Image, type ImageStyle } from "react-native";
import type { Family } from "../shared/model";

export const CHATGPT_ICON_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADiElEQVR4AZzWjXXUMBAEYIdKQiUJlQCVQCoBKiFUQqgE9vNjlLXO5zPkaW6l/Z1d6ZK8Wc7/PJbrl8LPwu/C94Lzh5L3hf9aZwhIrhj0Ygg5IwH8/pnELQKS6lix58r+sfC2cPcX70rSs/MLTAiQ/lQ+8pS4XLcI6EyUwop9rcNLIUvxbzmUVAjo+SH2ufSImFZtt+uIAOYSKArbyGVhkzgk+SBpOqRJkfT3y7Lwk7O2r+uIAMa60P1rxLJIpjAgoVuF+Nkv7ceZnl0u0xA/XK4RwJSjoOFcG124Z4XZJAaFyjyW2HGoDbtJ1HZBnFwxE1DA48GUg0ASkDIVe10ZcbcrKrl4JPnS8Yen+kCaDuq4LJ2AYEEMPbEzJEjxdEMPyClqMs6gGei65B26EJCAEkOd9ZctWQefnBFWOBMj78qYa5FTY4ho4EfZrAcfgACDQIl1R7IdYU7MV1Fjttepc/KF6HvGwqiBQJTGKrDsh8u0dIUE/ySjS6dJIKeJkvzEsP3yAQhEGfb0R4i/7nSpgL0C6ZQ02eRh58uHThOrvRNgOAPduGcy/vaIkHQmASFLpzgfUvF18ghQcKAkb+HogXab4q4Feu6Q8O4eEXCPigogO+ZRdtvR3iQycnl9UzoJdvEPCFx8NcrCwWQECTZO+zKdXhrTrVyCECEhNccEFJu7FezxxNYTSHIW4mdf5OhXAjZhOd8XPSIkP4m84D0ydGx8zsBEX1wBZ19Bj4ISCdOgD0wCMFeID/AHe2BLzJEUwz4IOASM7lxC++gV97DANBTzPsCeThPxP5LrV7AcnjOB2o+VcUsqOTIzERMbAbVR2FXlcZXq6pKXP8JPnUB+PUoimZFzch2IkGAySKmALN+ZENseEs+2xnQCijHkL1WSk2yKgg5yHSEpDhJrP8MDFU/vGuXd/D8gKaMCfeSKALsgweDMH/ibjNE699+IzsBHzCa2T4CTBBzzSOgggSFCF+jKFSEePzJ2enuFods2E+DkXowbESNDhn4P7tO/XyQ7cnMB8QjIuSksAOYJ0HUSukNEEskUo9Mxyd+1zH8d6aH7OF9gj4CE6URh03C/KYoEMpLpGuw72MWI17mmun3s9wgwGhkSgIAkgJwzOz8dZkKKIUeHrLMYOfju4hqBOEuAvSSgW2fffWQQQUi3oDgS4vmKsb+KWwSuBpZBAVAECYRIuvEmyu9w/QEAAP//O5eZFwAAAAZJREFUAwBo9Pe+jRmGfwAAAABJRU5ErkJggg==";

export const CLAUDE_ICON_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABBklEQVR4AeyTyxHCMAxEM2kG2qALjtAFLVAFXOmCOmjG5GVmZ8I6RhdEcgjDRlp97I0c993Cv03ANoH1TeB1OZ4y4ZeumkAp5VYSEQrwgmxeTSB7Q18/FFC67gm8MeL0gKguFLC/Pg4gWsjz9ACPOw8FeMOv+fIC/M77Gyrv8Yi3+hSX7f3O+8LKezzirT7FZZc/guhNsvM9d3WK7A2ne+H33NUpsgVM98LfvoFqApwL0FHgA+fE5uB1La54JYBzASrAB86JzcHrWlzxSoAS/7KrFnAfpgAGM/7xwUi+PKgBKsEH4h+2OYHd9XEGqsYH4i1LDVAeH4i7bQrwwiy+CUifQHR0bwAAAP//BBk4lQAAAAZJREFUAwACqDxQ05iHNgAAAABJRU5ErkJggg==";

export const ANTIGRAVITY_ICON_URI =
  "data:image/png;base64,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";

export const OPENCODE_ICON_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAlElEQVR4AeyWUQqAMAxD1ZN5E/Vk6k28mSaf/SiVWdFCJPkYxNA9BtvQffz9doARYOZksxOVVh6BCbE12exEpZU3gE29uNIApQhsOAr9TTOLaKxSBOLtNCREQAREQAREQARKEeAr+cSFd8fMIhqrFIF4Ow0JEfAI7KC5JJudqLTyBjgQ48s20+xErZU3gE09WEW/XgAAAP//N164DgAAAAZJREFUAwBV0ThB0L4GBAAAAABJRU5ErkJggg==";

export type PlatformType = Family | "antigravity" | "opencodeGo" | "opencode";

export interface PlatformIconInfo {
  label: string;
  uri: string;
}

export const DEFAULT_PLATFORM_INFO: PlatformIconInfo = {
  label: "Antigravity",
  uri: ANTIGRAVITY_ICON_URI,
};

export const PLATFORM_INFO: Record<PlatformType, PlatformIconInfo> = {
  codex: { label: "ChatGPT", uri: CHATGPT_ICON_URI },
  claude: { label: "Claude", uri: CLAUDE_ICON_URI },
  antigravity: { label: "Antigravity", uri: ANTIGRAVITY_ICON_URI },
  opencodeGo: { label: "OpenCode Go", uri: OPENCODE_ICON_URI },
  opencode: { label: "OpenCode Go", uri: OPENCODE_ICON_URI },
};

export function PlatformIcon({
  platform,
  size = 16,
  style,
}: {
  platform: PlatformType | string;
  size?: number;
  style?: ImageStyle;
}) {
  const info: PlatformIconInfo = (PLATFORM_INFO as Record<string, PlatformIconInfo>)[platform] ?? DEFAULT_PLATFORM_INFO;
  return (
    <Image
      source={{ uri: info.uri }}
      accessibilityLabel={info.label}
      style={[{ width: size, height: size, resizeMode: "contain" }, style]}
    />
  );
}
