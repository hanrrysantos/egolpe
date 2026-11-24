import { describe, expect, it } from "vitest";
import { acharChavesPix, acharLinks, acharTelefones, extrairPorRegex, unirComRegex } from "./regex";
import type { Extracao } from "@/src/nucleo/tipos";

// Todos os dados abaixo são sintéticos: domínios inventados ou .test, números e chaves fictícios.

const BOLETO_47 = "23790.12345 60000.123456 78901.234567 8 12340000015000";
const ARRECADACAO_48 = "83600000001-5 12340000000-6 00000000000-0 12345678901-2";

describe("acharLinks", () => {
  it("acha links com e sem http, inclusive com caminho", () => {
    const links = acharLinks(
      "Acesse caixa-premio.top/x agora ou https://rastreio-falso.test/pac?id=1. Também www.loja-exemplo.com.br",
    );
    expect(links).toEqual(["https://rastreio-falso.test/pac?id=1", "caixa-premio.top/x", "www.loja-exemplo.com.br"]);
  });

  it("acha encurtador sem http e tira pontuação do fim", () => {
    expect(acharLinks("clique: bit.ly/abc123).")).toEqual(["bit.ly/abc123"]);
  });

  it("não confunde e-mail, valor em reais ou palavras coladas com link", () => {
    expect(acharLinks("Mande para fulano@exemplo.test o valor de R$ 1.850,00. Obrigado.Tchau, beijo.mãe")).toEqual([]);
  });
});

describe("acharTelefones", () => {
  it("acha celular com DDD, 0800 e 4004 e marca quando a mensagem pede para ligar", () => {
    const tels = acharTelefones("Ligue para a central 0800 123 4567 ou 4004-0000. Meu número novo é (11) 91234-5678");
    expect(tels.map((t) => t.numero)).toEqual(["0800 123 4567", "4004-0000", "(11) 91234-5678"]);
    expect(tels[0]?.contexto).toBe("ligar_para");
  });

  it("não acha um 3003/4004 dentro de fixo com DDD", () => {
    expect(acharTelefones("fixo (11) 3000-0000").map((t) => t.numero)).toEqual(["(11) 3000-0000"]);
  });

  it("acha +55 sem formatação", () => {
    expect(acharTelefones("zap +5511912345678").map((t) => t.numero)).toEqual(["+5511912345678"]);
  });

  it("não confunde CPF nem 11 dígitos soltos com telefone", () => {
    expect(extrairPorRegex("CPF 123.456.789-09 protocolo 12345678901").telefones).toEqual([]);
  });
});

describe("linhas digitáveis", () => {
  it("acha boleto de 47 e arrecadação de 48 dígitos, sem virar telefone", () => {
    const r = extrairPorRegex(`Pague: ${BOLETO_47}\nConta de luz: ${ARRECADACAO_48}`);
    expect(r.linhasDigitaveis).toEqual([BOLETO_47, ARRECADACAO_48]);
    expect(r.telefones).toEqual([]);
  });

  it("acha linha digitável sem pontuação", () => {
    const soDigitos = BOLETO_47.replace(/\D/g, "");
    expect(extrairPorRegex(`linha ${soDigitos}`).linhasDigitaveis).toEqual([soDigitos]);
  });

  it("ignora sequências com outra quantidade de dígitos", () => {
    expect(extrairPorRegex("23790.12345 60000.123456").linhasDigitaveis).toEqual([]);
  });
});

describe("acharChavesPix", () => {
  it("acha CPF, CNPJ, chave aleatória e e-mail quando a mensagem fala de Pix", () => {
    const chaves = acharChavesPix(
      "Faz um Pix pra mim: 123.456.789-09 ou 12.345.678/0001-90 ou 1b2c3d4e-0000-4abc-8def-1234567890ab ou fulano@exemplo.test",
    );
    expect(chaves.map((c) => c.tipo)).toEqual(["cnpj", "cpf", "aleatoria", "email"]);
  });

  it("não trata CPF como chave Pix quando a mensagem não fala de Pix", () => {
    expect(acharChavesPix("Seu cadastro com CPF 123.456.789-09 foi atualizado")).toEqual([]);
  });
});

describe("unirComRegex", () => {
  const base: Extracao = {
    links: ["https://caixa-premio.top/x"],
    chavesPix: [{ valor: "123.456.789-09", tipo: "desconhecido" }],
    linhasDigitaveis: [],
    telefones: [{ numero: "11 91234-5678", contexto: "remetente" }],
    pedeDinheiro: true,
    pedeDadosSensiveis: false,
    urgencia: [],
    trechos: [],
    tipoProvavel: "falso_parente",
    tentativaDeManipulacao: false,
  };

  it("não duplica o que o modelo já achou e mantém a versão do modelo", () => {
    const texto = "Pix 12345678909, acesse caixa-premio.top/x/ ou ligue +55 (11) 91234-5678";
    const r = unirComRegex(base, extrairPorRegex(texto));
    expect(r.links).toEqual(["https://caixa-premio.top/x"]);
    expect(r.telefones).toEqual([{ numero: "11 91234-5678", contexto: "remetente" }]);
    expect(r.chavesPix).toHaveLength(1);
  });

  it("acrescenta o que só a regex achou", () => {
    const r = unirComRegex(base, extrairPorRegex(`outro site: entrega-taxa.test/pagar e boleto ${BOLETO_47}`));
    expect(r.links).toEqual(["https://caixa-premio.top/x", "entrega-taxa.test/pagar"]);
    expect(r.linhasDigitaveis).toEqual([BOLETO_47]);
  });
});
