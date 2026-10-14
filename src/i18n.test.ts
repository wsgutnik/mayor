import { afterEach, describe, expect, it } from "vitest";
import { lineName, monthName, setLang, tr, trReason } from "./i18n";

afterEach(() => setLang("pt"));

describe("i18n", () => {
  it("translates known strings and passes unknown ones through", () => {
    setLang("pt");
    expect(tr("Population")).toBe("População");
    expect(tr("Something new")).toBe("Something new");
    setLang("en");
    expect(tr("Population")).toBe("Population");
  });

  it("fills placeholders in both languages", () => {
    setLang("pt");
    expect(tr("Saved to slot {n}", { n: 2 })).toBe("Salvo no slot 2");
    setLang("en");
    expect(tr("Saved to slot {n}", { n: 2 })).toBe("Saved to slot 2");
  });

  it("translates simulation reasons, including parametrised ones", () => {
    setLang("pt");
    expect(trReason("Not enough money")).toBe("Dinheiro insuficiente");
    expect(trReason("Water pump must be within 3 tiles of water")).toContain("Bomba d'água");
    expect(trReason("Use only bus stops")).toBe("Use apenas pontos de ônibus");
    setLang("en");
    expect(trReason("Not enough money")).toBe("Not enough money");
  });

  it("explains road overlap refusals with what to do instead, in both languages", () => {
    setLang("pt");
    expect(trReason("Overlaps another road")).toBe("Sobrepõe outra via: use Melhorar via para mudar a classe, ou desenhe em paralelo, fora da calçada");
    expect(trReason("Crossing angle too sharp")).toContain("Ângulo de cruzamento fechado demais: cruze a 20°");
    expect(trReason("Road already exists here")).toBe("Já existe uma via aqui: use Melhorar via para mudar a classe");
    setLang("en");
    expect(trReason("Overlaps another road")).toBe("Overlaps another road: use Upgrade road to change its class, or draw it parallel, clear of the sidewalk");
    expect(trReason("Crossing angle too sharp")).toBe("Crossing angle too sharp: cross at 20° or more, or end on the road to make a junction");
  });

  it("translates the interface-scale settings", () => {
    setLang("pt");
    expect(tr("Interface scale")).toBe("Escala da interface");
    expect(tr("Panel opacity")).toBe("Opacidade dos painéis");
    setLang("en");
    expect(tr("Interface scale")).toBe("Interface scale");
    expect(tr("Panel opacity")).toBe("Panel opacity");
  });

  it("names months and lines per language", () => {
    setLang("pt");
    expect(monthName(1)).toBe("fev");
    expect(lineName("Bus 3")).toBe("Ônibus 3");
    expect(lineName("Metro 1")).toBe("Metrô 1");
    setLang("en");
    expect(monthName(1)).toBe("Feb");
    expect(lineName("Bus 3")).toBe("Bus 3");
  });
});
