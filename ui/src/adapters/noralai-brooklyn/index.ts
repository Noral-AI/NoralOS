import type { UIAdapterModule } from "../types";
import {
  buildBrooklynConfig,
  parseBrooklynStdoutLine,
} from "@noralos-plugins/noralai-brooklyn/ui";

import { BrooklynConfigFields } from "./config-fields";

export const noralaiBrooklynUIAdapter: UIAdapterModule = {
  type: "noralai_brooklyn",
  label: "NoralAI",
  parseStdoutLine: parseBrooklynStdoutLine,
  ConfigFields: BrooklynConfigFields,
  buildAdapterConfig: buildBrooklynConfig,
};
