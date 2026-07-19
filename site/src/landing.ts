const sections = [...document.querySelectorAll<HTMLElement>("main .section")];
const navLinks = [...document.querySelectorAll<HTMLAnchorElement>(".site-nav nav a[href^='#']")];

const reveal = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) entry.target.classList.add("is-visible");
    }
  },
  { threshold: 0.18 },
);

for (const section of sections) reveal.observe(section);

const active = new IntersectionObserver(
  (entries) => {
    const current = entries.find((entry) => entry.isIntersecting)?.target.id;
    if (!current) return;
    for (const link of navLinks) {
      link.classList.toggle("is-active", link.hash === `#${current}`);
    }
  },
  { rootMargin: "-35% 0px -55% 0px", threshold: 0.01 },
);

for (const section of sections.filter((section) => section.id)) active.observe(section);
