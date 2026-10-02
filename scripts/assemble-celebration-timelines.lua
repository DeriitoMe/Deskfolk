-- Import the measured renderer's PNG sequences into new native Aseprite files.
-- aseprite -b --script-param root=<project root> --script scripts/assemble-celebration-timelines.lua
-- Optional: --script-param frames=<directory containing the three clip folders>
local root=assert(app.params.root,'project root required')
local frames=app.params.frames or root..'/.cache/celebration-20261002/frames'
local dest=root..'/assets/characters/wakaba-mutsumi/celebration-20261002'
local clips={
  {name='touch',count=48,milliseconds=1600,label='Touch / two forehead sweat drops',tag='touch_forehead_sweat_30fps'},
  {name='celebrate-poppers',count=75,milliseconds=2500,label='A / both hands raise mini confetti poppers',tag='A_dual_poppers_30fps'},
  {name='celebrate-clap',count=72,milliseconds=2400,label='D / two gentle claps with quiet stars',tag='D_gentle_double_clap_30fps'}
}

local function path(clip,index)
  return frames..'/'..clip.name..'/frame-'..string.format('%03d',index)..'.png'
end

-- Validate completeness before saving any timelines.
for _,clip in ipairs(clips) do
  for index=0,clip.count-1 do
    local file=assert(io.open(path(clip,index),'rb'),'Missing rendered frame '..path(clip,index))
    file:close()
  end
end

local reports={}
for _,clip in ipairs(clips) do
  local first=Image{fromFile=path(clip,0)}
  local sprite=Sprite(first.width,first.height,ColorMode.RGB)
  sprite.layers[1].name=clip.label..' / rendered motion; props editable in Blender'
  local total=0
  for frame=1,clip.count do
    if frame>1 then sprite:newEmptyFrame() end
    local milliseconds=frame%3==0 and 34 or 33
    sprite.frames[frame].duration=milliseconds/1000
    total=total+milliseconds
    local image=frame==1 and first or Image{fromFile=path(clip,frame-1)}
    assert(image.width==sprite.width and image.height==sprite.height,'Frame dimensions changed within '..clip.name)
    sprite:newCel(sprite.layers[1],frame,image,Point(0,0))
  end
  assert(total==clip.milliseconds,'Timeline duration mismatch')
  local tag=sprite:newTag(1,clip.count)
  tag.name=clip.tag
  local filename=dest..'/source/'..clip.name..'-30fps.aseprite'
  sprite:saveAs(filename)

  -- GIF stores centiseconds. Use 30/40 ms preview frames to preserve the exact
  -- total duration while the editable native source remains 33/34 ms at 30 FPS.
  for frame=1,clip.count do sprite.frames[frame].duration=(frame%3==0 and 40 or 30)/1000 end
  sprite:saveCopyAs(dest..'/preview/'..clip.name..'.gif')
  sprite:close()

  local reopened=assert(app.open(filename),'Could not reopen native timeline '..filename)
  assert(#reopened.frames==clip.count and #reopened.layers==1 and #reopened.tags==1)
  assert(reopened.tags[1].name==clip.tag)
  local savedTotal=0
  for frame=1,#reopened.frames do
    local milliseconds=math.floor(reopened.frames[frame].duration*1000+.5)
    assert(milliseconds==(frame%3==0 and 34 or 33))
    assert(reopened.layers[1]:cel(frame),'Missing cel in reopened timeline')
    savedTotal=savedTotal+milliseconds
  end
  assert(savedTotal==clip.milliseconds)
  reports[#reports+1]={name=clip.name,count=clip.count,milliseconds=savedTotal,width=reopened.width,height=reopened.height,tag=clip.tag}
  reopened:close()
  print('NATIVE_TIMELINE_VERIFIED '..clip.name..' '..clip.count..' frames / '..savedTotal..' ms')
end

local file=assert(io.open(dest..'/source/animation-timelines-verification.json','w'))
file:write('{\n  "nativeTool":"Aseprite '..tostring(app.version)..'",\n  "fps":30,\n  "durationsMs":[33,33,34],\n  "savedAndReopened":true,\n  "clips":[\n')
for index,item in ipairs(reports) do
  file:write('    {"name":"'..item.name..'","frames":'..item.count..',"durationMs":'..item.milliseconds..',"width":'..item.width..',"height":'..item.height..',"layers":1,"tag":"'..item.tag..'"}'..(index<#reports and ',' or '')..'\n')
end
file:write('  ]\n}\n');file:close()
