"""디스코드 글자 수 제한에 맞춰 메시지·임베드를 나눠 보내는 도구"""
import discord

EMBED_FIELD_LIMIT = 1024   # 임베드 칸(field) 하나의 최대 글자 수
EMBED_TOTAL_LIMIT = 5500   # 임베드 전체 최대 6000자, 여유를 둠
EMBED_MAX_FIELDS = 25      # 임베드 하나에 들어가는 최대 칸 수
MESSAGE_LIMIT = 2000       # 일반 메시지 최대 글자 수

def split_text(text, limit):
    """줄 단위로 limit 글자 이하 덩어리로 나눔. 한 줄이 너무 길면 잘라냄."""
    chunks, current = [], ""
    for line in str(text).split("\n"):
        if len(line) > limit:
            line = line[:limit - 1] + "…"
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > limit:
            chunks.append(current)
            current = line
        else:
            current = candidate
    if current or not chunks:
        chunks.append(current or "-")
    return chunks

def build_embeds(title, color, description=None, fields=(), footer=None, image_url=None, thumbnail_url=None):
    """fields: (이름, 내용, inline) 목록. 내용이 길면 칸을, 칸이 많으면 임베드를 나눔"""
    def new_embed(first):
        e = discord.Embed(title=title if first else f"{title} (계속)", color=color)
        if first and description:
            e.description = description[:4000]
        return e

    embeds = [new_embed(True)]
    for name, value, inline in fields:
        for i, chunk in enumerate(split_text(value, EMBED_FIELD_LIMIT)):
            field_name = (name if i == 0 else f"{name} (계속)")[:256]
            e = embeds[-1]
            if len(e.fields) >= EMBED_MAX_FIELDS or len(e) + len(field_name) + len(chunk) > EMBED_TOTAL_LIMIT:
                e = new_embed(False)
                embeds.append(e)
            e.add_field(name=field_name, value=chunk, inline=inline)

    if footer:
        embeds[-1].set_footer(text=footer[:300])
    if image_url:
        embeds[0].set_image(url=image_url)
    if thumbnail_url:
        embeds[0].set_thumbnail(url=thumbnail_url)
    return embeds

async def send_embeds(channel, embeds, content=None):
    for i, embed in enumerate(embeds):
        await channel.send(content=content if i == 0 else None, embed=embed)

async def respond_embeds(interaction, embeds, ephemeral=False):
    # 디스코드는 메시지 하나에 임베드 전체 6000자 제한이 있어서 하나씩 보냄
    await interaction.response.send_message(embed=embeds[0], ephemeral=ephemeral)
    for embed in embeds[1:]:
        await interaction.followup.send(embed=embed, ephemeral=ephemeral)

async def send_long_message(channel, text):
    for chunk in split_text(text, MESSAGE_LIMIT):
        await channel.send(chunk)

def fit_choice(name):
    # 자동완성 선택지 이름은 최대 100자
    return name if len(name) <= 100 else name[:99] + "…"
