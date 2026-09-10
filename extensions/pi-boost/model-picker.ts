/** Use Pi's /model component, backed by the current session's public registry. */
import { ModelSelectorComponent, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type PickerRuntime = ConstructorParameters<typeof ModelSelectorComponent>[2];

export function createBoostModelPicker(
	ctx: ExtensionContext,
	tui: ConstructorParameters<typeof ModelSelectorComponent>[0],
	current: string,
	done: (value?: string) => void,
): ModelSelectorComponent {
	// SDK 0.84.4's selector takes ModelRuntime, but extension contexts expose
	// ModelRegistry. Adapt only the four public methods used by the selector;
	// never open another registry/auth store or reach into private runtime fields.
	const runtime: Pick<PickerRuntime, "getAvailableSnapshot" | "getModel" | "getError" | "refresh"> = {
		getAvailableSnapshot: () => ctx.modelRegistry.getAvailable(),
		getModel: (provider, id) => ctx.modelRegistry.find(provider, id),
		getError: () => ctx.modelRegistry.getError(),
		refresh: (options) => ctx.modelRegistry.refresh(options),
	};
	const selected = ctx.modelRegistry.getAvailable().find((model) => `${model.provider}/${model.id}` === current);
	return new ModelSelectorComponent(
		tui,
		selected ?? ctx.model,
		runtime as PickerRuntime,
		ctx.scopedModels,
		(model) => {
			if (!model.input.includes("text")) {
				ctx.ui.notify("Boost requires a text-capable model.", "warning");
				done();
				return;
			}
			done(`${model.provider}/${model.id}`);
		},
		() => done(),
	);
}
