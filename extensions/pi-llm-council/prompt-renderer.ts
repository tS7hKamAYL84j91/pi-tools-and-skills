/** Shared markdown prompt template rendering. */

interface TemplateValues {
	[key: string]: string;
}

export function renderTemplate(lines: string[], values: TemplateValues): string {
	let rendered = lines.join("\n");
	for (const [key, value] of Object.entries(values)) {
		rendered = rendered.replaceAll(`{{${key}}}`, value);
	}
	return rendered;
}
