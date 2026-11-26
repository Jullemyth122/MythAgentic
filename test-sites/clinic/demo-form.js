// Demo sites only: a sent form shows what would have been sent, and sends nothing.
// This stands in for the business's own form handler, so an agent pack can submit the
// form exactly as the page itself would.
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const old = form.parentElement.querySelector(".demo-receipt");
  if (old) old.remove();
  const box = document.createElement("div");
  box.className = "demo-receipt";
  box.setAttribute("role", "status");
  const title = document.createElement("strong");
  if (form.querySelector("input[type=password]")) {
    title.textContent = "Demo site: there is no real login here.";
    box.append(title);
  } else {
    title.textContent = "Request received (demo: nothing was sent anywhere).";
    const list = document.createElement("ul");
    for (const [name, value] of new FormData(form)) {
      if (!String(value).trim()) continue;
      const item = document.createElement("li");
      item.textContent = `${name}: ${value}`;
      list.append(item);
    }
    box.append(title, list);
  }
  form.after(box);
  box.scrollIntoView({ block: "nearest" });
});
