const settings = globalThis.__CHATGPT_HELPER__.settings;
const extensionApi = globalThis.__CHATGPT_HELPER__.extensionApi;
const form = document.querySelector("form");
const fieldset = document.querySelector("fieldset");
const status = document.querySelector("#status");
function selectLayout(value) {
  form.querySelector(`input[name="layout"][value="${settings.normalizeLayout(value)}"]`).checked = true;
}
function selectTheme(value) {
  const theme = settings.normalizeTheme(value);
  form.querySelector(`input[name="theme"][value="${theme}"]`).checked = true;
  document.documentElement.dataset.theme = theme;
}
async function load() {
  try {
    const values = await extensionApi.storage.local.get(["layout", "theme"]);
    selectLayout(values.layout);
    selectTheme(values.theme);
    fieldset.disabled = false;
    status.textContent = "";
  } catch (error) {
    status.textContent = "读取设置失败，请重新打开配置页。";
  }
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const layout = settings.normalizeLayout(new FormData(form).get("layout"));
  const theme = settings.normalizeTheme(new FormData(form).get("theme"));
  fieldset.disabled = true;
  try {
    await extensionApi.storage.local.set({ layout, theme });
    status.textContent = "已保存";
  } catch (error) {
    status.textContent = "保存失败，请重试。";
  } finally {
    fieldset.disabled = false;
  }
});
extensionApi.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.layout) selectLayout(changes.layout.newValue);
  if (area === "local" && changes.theme) selectTheme(changes.theme.newValue);
});
form.addEventListener("change", async (event) => {
  if (event.target.name !== "theme") return;
  const theme = settings.normalizeTheme(event.target.value);
  selectTheme(theme);
  fieldset.disabled = true;
  try {
    await extensionApi.storage.local.set({ theme });
    status.textContent = "主题已保存";
  } catch (error) {
    status.textContent = "主题保存失败，请重试。";
  } finally { fieldset.disabled = false; }
});
load();
