# É golpe? 

**Encaminhe a mensagem suspeita. Receba um veredito claro, em segundos.**

Bot no Telegram que analisa mensagens, prints, links e áudios suspeitos e diz, em linguagem simples, se aquilo é seguro, suspeito ou golpe, explicando por quê e o que fazer agora. Pensado para quem tem pouca familiaridade com tecnologia e para as famílias que cuidam dessas pessoas.

> Projeto desenvolvido para o **Hack Brasil 2026**, trilha **Cibersegurança**.

- **Bot:** `@EGolpeBot` _(a definir)_
- **Site:** _(a definir)_
- **Vídeo de demonstração:** _(a definir)_

## O problema

O golpe digital virou o crime patrimonial mais comum do Brasil.

- O país registrou **2.261.055 ocorrências de estelionato em 2025**, alta de 3,1% sobre 2024 e de **429,8% desde 2018**, quando começou a série histórica do Anuário Brasileiro de Segurança Pública. O próprio Anuário liga esse crescimento à digitalização dos serviços financeiros e ao uso disseminado do Pix.
- Segundo pesquisa Datafolha com o Fórum Brasileiro de Segurança Pública (julho de 2024 a junho de 2025), **33,4% dos brasileiros com 16 anos ou mais foram vítimas de fraude digital com prejuízo financeiro**, contra 21,8% vítimas de crimes presenciais.
- Na mesma pesquisa, **cerca de 24 milhões de pessoas caíram em golpes de Pix ou boleto falso**, com prejuízo médio de **R$ 1.198 por vítima**, e **46,4 milhões receberam mensagens ou ligações de falsas centrais de atendimento**.

Os registros oficiais ficam abaixo da realidade, porque boa parte das vítimas não registra ocorrência.

### Por que acontece

O golpe não explora uma falha técnica; explora a **pressa e a emoção**. O criminoso cria urgência ("minha conta foi bloqueada", "seu benefício vai ser suspenso", "preciso pagar isso hoje") para que a vítima aja antes de desconfiar. Quem recebe a mensagem até tem a quem perguntar, como o filho, o neto ou o banco, mas nem sempre essa pessoa está disponível no momento em que a decisão precisa ser tomada.

### Público

- **Principal:** pessoas idosas ou com pouca familiaridade digital, que usam o celular para mensagens e Pix, mas têm dificuldade de reconhecer sinais de fraude.
- **Secundário:** filhos, netos e cuidadores que querem proteger essas pessoas.

## Um exemplo de como acontece

> Cenário ilustrativo, montado a partir de padrões de golpe amplamente relatados. Nomes e números são fictícios.

Dona Lúcia, 67 anos, recebe no WhatsApp uma mensagem de um número desconhecido, com a foto do filho no perfil:

> _"Oi mãe, troquei de número, salva esse aqui. O outro deu problema."_

Uma hora depois:

> _"Mãe, tô com um problema aqui, preciso pagar um boleto hoje senão vai dar juros. Meu app do banco tá bloqueado. Consegue fazer um Pix de R$ 1.850 pra essa chave? Te devolvo amanhã."_

O texto não tem erros de português, a foto é do filho e o valor é crível. Ela não quer incomodar o filho no trabalho para confirmar, até porque, na cabeça dela, é com ele que está falando.

**Com o É golpe?**, ela tira um print da conversa e manda para o bot. Em segundos, recebe:

> 🔴 **Isso é golpe.**
>
> - A mensagem diz que é do seu filho, mas vem de um número novo, e o pedido de dinheiro chegou logo depois da troca.
> - Há pressa ("hoje", "senão vai dar juros") é uma desculpa para ele não poder pagar sozinho.
> - A chave Pix está no nome de outra pessoa.
>
> **O que fazer agora:**
> 1. Não faça o Pix.
> 2. Ligue para o número antigo do seu filho e confirme com ele.
> 3. Se já tiver pago, ligue para o seu banco e peça a devolução pelo Pix.

Esse tipo de golpe causa prejuízos grandes: em fevereiro de 2026, um médico de Minas Gerais registrou boletim de ocorrência após perder mais de R$ 113 mil no golpe do falso parente.


## A solução

O **É golpe?** funciona onde a pessoa já está: numa conversa de mensagens. Não é preciso instalar nada novo nem aprender a usar um site.

### Como funciona

1. **A pessoa envia** o que recebeu: texto colado, print da conversa, link ou um áudio contando o que aconteceu (por exemplo, uma ligação suspeita).
2. **O bot extrai** do conteúdo o que importa: links, chaves Pix, linha digitável de boleto, telefones e quem a mensagem diz ser.
3. **O bot verifica fatos** que um chatbot comum não verifica:
   - idade do domínio e semelhança com sites de bancos, governo e lojas conhecidas;
   - destino real de links encurtados;
   - presença em listas públicas de phishing;
   - no boleto, se o banco codificado na linha digitável bate com o emissor alegado.
4. **O bot responde** com um veredito em três níveis (🟢 seguro, 🟡 suspeito, 🔴 golpe), os motivos com as evidências encontradas e um roteiro do que fazer agora.

### Por que não simplesmente perguntar a um chatbot de IA?

| | Chatbot genérico | É golpe? |
|---|---|---|
| Verifica domínio, links e boleto | ❌ Opina com base no texto | ✅ Consulta fontes e regras verificáveis |
| Veredito | Pode inventar justificativas | Só afirma o que as verificações sustentam |
| O que fazer depois | Varia a cada resposta | Roteiro revisado para cada tipo de golpe |
| Precisão | Desconhecida | Medida e publicada (ver [Avaliação](#avaliação)) |
| Para quem não sabe formular a pergunta | Exige saber o que perguntar | Basta encaminhar ou mandar um print |

### Golpes cobertos _(proposta, a confirmar)_

- Falso parente ("troquei de número")
- Falsa central de atendimento do banco
- Taxa falsa de entrega (Correios, transportadoras, alfândega)
- Boleto adulterado e páginas falsas de governo ("valores a receber", benefícios)

### Privacidade

- Mensagens enviadas ao bot **não são armazenadas** depois da análise.
- Todos os exemplos usados no desenvolvimento e na demonstração são **sintéticos**: nenhum dado pessoal real de terceiros.
- Cada usuário tem um **limite de análises por hora**, para evitar abuso do serviço.

### Canais

- **Agora:** bot no Telegram, com uma landing page que explica o projeto e leva ao bot.
- **Próximo passo:** o mesmo bot no WhatsApp, onde está a maior parte do público-alvo. O núcleo de análise é separado do canal, então um novo canal é só um novo adaptador.

## Arquitetura

```
Telegram ──► Adaptador do canal ──► Núcleo de análise ──► Veredito
                                      │
                                      ├─ 1. Extração (modelo multimodal)
                                      ├─ 2. Sinais determinísticos
                                      └─ 3. Síntese do veredito
```

- **Adaptador do canal:** converte a mensagem do Telegram (texto, imagem, áudio) para um formato comum e devolve o veredito com botões.
- **Extração:** um modelo multimodal lê prints e textos e devolve dados estruturados. Áudios passam antes por transcrição.
- **Sinais determinísticos:** verificações em código, sem IA, que produzem evidências objetivas.
- **Síntese:** o modelo recebe as evidências e escreve o veredito em linguagem simples, sem afirmar nada que as evidências não sustentem.

### Formato do veredito

```json
{
  "nivel": "golpe",
  "tipo": "falso_parente",
  "motivos": [
    {
      "texto": "Pede Pix urgente logo depois de dizer que trocou de número",
      "evidencia": "Mensagem 1: 'troquei de número'; mensagem 2: pedido de Pix"
    }
  ],
  "o_que_fazer": [
    "Não faça o Pix",
    "Ligue para o número antigo do seu parente"
  ]
}
```

## Stack

| Camada | Tecnologia | Status |
|---|---|---|
| Canal | Bot API do Telegram | ✅ Decidido |
| Landing page | Página web estática que leva ao bot | ✅ Decidido |
| Linguagem | TypeScript | _Proposta_ |
| Backend e site | Next.js | _Proposta_ |
| Modelo multimodal | _A definir_ (testar 2 modelos com os mesmos exemplos) | ⏳ |
| Transcrição de áudio | _A definir_ | ⏳ |
| Consulta de domínios | RDAP | _Proposta_ |
| Listas de phishing | _A definir_ (conferir termos de uso) | ⏳ |
| Hospedagem | _A definir_ (precisa ficar no ar durante toda a avaliação) | ⏳ |

## Avaliação

_(a preencher)_

Conjunto de cerca de 100 mensagens sintéticas, entre golpes e mensagens legítimas parecidas (avisos reais de banco, rastreios reais), com a taxa de acerto do bot por nível de veredito.

| Métrica | Resultado |
|---|---|
| Acerto geral | — |
| Golpes identificados como golpe | — |
| Mensagens legítimas identificadas como seguras | — |

## Como usar

_(em breve: preenchido quando houver código)_

### Usando o bot

1. Abra o bot no Telegram: _(link)_
2. Envie a mensagem suspeita: texto, print, link ou áudio.
3. Leia o veredito e siga o roteiro do que fazer.

### Rodando localmente

```bash
# pré-requisitos, instalação e variáveis de ambiente a definir
```

## Equipe

| Nome | Frente |
|---|---|
| _Nome_ | Interface e experiência |
| _Nome_ | Extração e síntese |
| _Nome_ | Sinais e integrações |
| _Nome_ | Avaliação, deploy e vídeo |

## Licença

[MIT](LICENSE)

## Referências

- [Golpes sobem 430% desde 2018 e lideram crimes contra o patrimônio (Metrópoles, jul. 2026)](https://www.metropoles.com/brasil/golpes-sobem-430-desde-2018-anuario-seguranca-publica)
- [Estelionatos sobem 3,1%, e Brasil registra 258 golpes por hora em 2025 (Jovem Pan, jul. 2026)](https://jovempan.com.br/?p=263399)
- [Brasil teve 32 milhões de pessoas chantageadas por dados vazados em um ano (Jornal de Brasília, sobre a pesquisa Datafolha/FBSP)](https://jornaldebrasilia.com.br/noticias/brasil/brasil-teve-32-milhoes-de-pessoas-chantageadas-por-dados-vazados-em-um-ano-diz-pesquisa/)
- [Brasileiros que pagaram por produto não entregue (Metrópoles, sobre a pesquisa Datafolha/FBSP)](https://www.metropoles.com/sao-paulo/brasileiros-produto-nao-entregue)
- [Brasil tem 24 milhões de vítimas de golpes digitais e Pix falso (Agora RN)](https://agorarn.com.br/economia/brasil-tem-24-milhoes-de-vitimas-de-golpes-digitais-e-pix-falso-prejuizo-chega-a-r-29-bilhoes/)
- [Golpe do WhatsApp falso tira quase R$ 115 mil de brasileiro (TNH1, fev. 2026)](https://www.tnh1.com.br/tnh1-variedades/?p=15363)