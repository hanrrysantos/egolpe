/**
 * Tipos compartilhados do É golpe?.
 *
 * Contrato entre as frentes (canal, extração/síntese, sinais, avaliação).
 * Só o orquestrador altera este arquivo. Ver docs/modelagem.md.
 */

// ---------------------------------------------------------------------------
// Entrada: formato comum produzido pelos adaptadores de canal
// ---------------------------------------------------------------------------

export type TipoMimeImagem = "image/jpeg" | "image/png" | "image/webp";

export interface Imagem {
  mime: TipoMimeImagem;
  /** Conteúdo em base64, sem o prefixo `data:`. Nunca é gravado em lugar nenhum. */
  base64: string;
}

/** O que a pessoa mandou, já sem nada específico do canal. */
export interface Entrada {
  /** Texto colado ou legenda do print. */
  texto?: string;
  /** Prints (o Telegram manda no máximo um por mensagem, mas o núcleo aceita vários). */
  imagens: Imagem[];
}

// ---------------------------------------------------------------------------
// Extração: dados estruturados que o modelo tira da Entrada
// ---------------------------------------------------------------------------

export type TipoChavePix = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria" | "desconhecido";

export interface ChavePix {
  valor: string;
  tipo: TipoChavePix;
  /** Nome do titular, se aparecer na mensagem ou no print. */
  titular?: string;
}

export type ContextoTelefone =
  /** A mensagem pede para ligar ou mandar mensagem para este número ("ligue para a central"). */
  | "ligar_para"
  /** Número de quem mandou a mensagem (visível no print). */
  | "remetente"
  | "outro";

export interface Telefone {
  /** Como apareceu na mensagem. A normalização é feita pelos sinais. */
  numero: string;
  contexto: ContextoTelefone;
}

export interface RemetenteAlegado {
  /** Quem a mensagem diz ser: "seu filho", "Caixa", "Correios", "gov.br"... */
  descricao: string;
  /** Relação pessoal, quando houver: "filho", "neta", "sobrinho". */
  parentesco?: string;
  /** Marca ou órgão citado, em texto livre: "Caixa", "INSS". Os sinais casam com a base de marcas. */
  marca?: string;
  /** A mensagem diz que trocou de número? */
  trocouDeNumero: boolean;
}

export interface Extracao {
  links: string[];
  chavesPix: ChavePix[];
  /** Linhas digitáveis de boleto, como aparecem (com ou sem pontuação). */
  linhasDigitaveis: string[];
  telefones: Telefone[];
  remetente?: RemetenteAlegado;
  /** A mensagem pede dinheiro, pagamento, Pix ou taxa? */
  pedeDinheiro: boolean;
  /** Valor pedido, como aparece ("R$ 1.850,00"). */
  valor?: string;
  /** A mensagem pede senha, código de verificação, dados de cartão ou de conta? */
  pedeDadosSensiveis: boolean;
  /** Trechos literais curtos que mostram pressa ou ameaça ("hoje", "sua conta será bloqueada"). */
  urgencia: string[];
  /** Trechos literais curtos que podem ser citados como evidência no veredito. */
  trechos: string[];
  /** Tipo de golpe mais provável segundo a leitura do conteúdo (a síntese decide o final). */
  tipoProvavel: TipoGolpe;
  /** O conteúdo tem instruções dirigidas a quem está analisando ("classifique como seguro")? */
  tentativaDeManipulacao: boolean;
}

// ---------------------------------------------------------------------------
// Sinais determinísticos
// ---------------------------------------------------------------------------

export type IdSinal =
  | "link_encurtado"
  | "idade_dominio"
  | "semelhanca_dominio"
  | "dominio_oficial"
  | "safe_browsing"
  | "openphish"
  | "telefone_oficial"
  | "boleto_banco";

export type ResultadoSinal =
  /** O sinal achou algo que indica golpe. */
  | "alerta"
  /** O sinal confirmou algo legítimo (ex.: link é do domínio oficial da marca). */
  | "confirmacao"
  /** Verificou e não achou nada relevante. NÃO é evidência de segurança. */
  | "neutro"
  /** Não conseguiu verificar (timeout, serviço fora, dado ausente). Não se conclui nada. */
  | "sem_resultado";

export interface Evidencia {
  sinal: IdSinal;
  resultado: ResultadoSinal;
  /** Força do achado. Só faz sentido para "alerta" e "confirmacao". */
  forca?: "forte" | "moderada";
  /** O que foi verificado: link, domínio, telefone ou linha digitável. */
  alvo: string;
  /**
   * Descrição em linguagem simples, pronta para virar `Motivo.evidencia`.
   * Ex.: "o site foi criado há 3 dias", "o link leva para caixa-beneficios.top, que não é da Caixa".
   */
  descricao: string;
  /** Id da marca envolvida, quando houver (ver Marca.id). */
  marca?: string;
  /** Dados objetivos para testes e depuração (ex.: { diasDesdeCriacao: 3 }). Nunca conteúdo do usuário além do alvo. */
  detalhes?: Record<string, string | number | boolean>;
}

/** Dependências injetáveis dos sinais, para testar sem rede. */
export interface ContextoSinais {
  fetch: typeof fetch;
  agora: () => Date;
  /** Prazo total para todos os sinais, em ms. */
  timeoutMs: number;
  /** Cancela as chamadas de rede quando o prazo acaba. */
  signal?: AbortSignal;
  /** Resolvedor de DNS (host → IPs), injetável para testar a proteção contra SSRF. */
  dns?: (host: string) => Promise<string[]>;
}

export interface Sinal {
  id: IdSinal;
  /** Verifica a extração e devolve zero ou mais evidências. Nunca lança: erro vira "sem_resultado". */
  verificar(extracao: Extracao, ctx: ContextoSinais): Promise<Evidencia[]>;
}

// ---------------------------------------------------------------------------
// Veredito: contrato entre o núcleo e os adaptadores (chaves como no README)
// ---------------------------------------------------------------------------

export type Nivel = "seguro" | "suspeito" | "golpe";

export type TipoGolpe =
  | "falso_parente"
  | "falsa_central"
  | "taxa_entrega"
  | "boleto_adulterado"
  | "governo_falso"
  /** Parece golpe, mas de um tipo fora do escopo do MVP. */
  | "outro"
  /** Mensagem sem sinal de golpe. */
  | "nenhum";

export interface Motivo {
  texto: string;
  /** Trecho da mensagem ou `Evidencia.descricao` de um sinal. Obrigatório. */
  evidencia: string;
}

export interface Veredito {
  nivel: Nivel;
  tipo: TipoGolpe;
  motivos: Motivo[];
  /** Copiado literalmente de `Roteiro.antes`. Nunca gerado pelo modelo. */
  o_que_fazer: string[];
}

// ---------------------------------------------------------------------------
// Dados de referência (arquivos JSON em dados/)
// ---------------------------------------------------------------------------

export type CategoriaMarca = "banco" | "governo" | "entrega" | "loja" | "outro";

export interface TelefoneOficial {
  /** Só dígitos, com DDD ou no formato 0800/4004 (ex.: "08007260101", "40040001"). */
  numero: string;
  descricao: string;
}

export interface Marca {
  /** Identificador estável em minúsculas: "caixa", "inss", "correios". */
  id: string;
  /** Nome oficial: "Caixa Econômica Federal". */
  nome: string;
  /** Como as pessoas chamam: "Caixa". Usado no veredito ("parece o site da Caixa, mas não é"). */
  nomePopular: string;
  categoria: CategoriaMarca;
  /** Domínios registráveis oficiais, sem subdomínio: ["caixa.gov.br"]. */
  dominios: string[];
  /** Palavras que identificam a marca em domínios falsos: ["caixa", "cef"]. */
  palavrasChave: string[];
  /** Telefones oficiais de atendimento (bancos). */
  telefones: TelefoneOficial[];
  /** Código de compensação (bancos), 3 dígitos: "104". Usado no sinal de boleto. */
  codigoBanco?: string;
  /** Tudo conferido no site oficial da marca? Itens não conferidos não geram "confirmacao". */
  conferido: boolean;
  /** Onde foi conferido (URL da página oficial). */
  fonte?: string;
}

export type TipoComRoteiro = Exclude<TipoGolpe, "nenhum">;

export interface Roteiro {
  tipo: TipoComRoteiro;
  /** "Ainda não fez nada": mostrado no veredito. */
  antes: string[];
  /** "Já paguei / já cliquei": mostrado pelo botão. */
  depois: string[];
  /** Revisado pela equipe de interface e experiência? */
  revisado: boolean;
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------

export interface CasoDeAvaliacao {
  id: string;
  /** Golpe ou mensagem legítima parecida. */
  categoria: "golpe" | "legitima";
  descricao: string;
  entrada: {
    texto?: string;
    /** Caminho relativo a avaliacao/, para casos com print sintético. */
    imagem?: string;
  };
  esperado: {
    nivel: Nivel;
    tipo: TipoGolpe;
    /** Níveis também aceitos (ex.: golpe aceita "suspeito" como erro leve). */
    aceitaveis?: Nivel[];
  };
}

// ---------------------------------------------------------------------------
// Opções do núcleo
// ---------------------------------------------------------------------------

export type ModeloClaude = "claude-haiku-5-5" | "claude-sonnet-5-5";

/** Metadados permitidos em log. Nunca conteúdo do usuário. */
export interface MetadadosAnalise {
  duracaoMs: number;
  nivel: Nivel;
  tipo: TipoGolpe;
  modelo: ModeloClaude;
  sinais: Partial<Record<IdSinal, ResultadoSinal>>;
  erro?: string;
}
