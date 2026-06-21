import { prisma } from './services/db.js';

async function main() {
  const videos = await prisma.video.findMany();
  console.log("ALL VIDEOS IN DATABASE:");
  for (const v of videos) {
    console.log(`- ID: ${v.id}, Name: ${v.name}, Status: ${v.status}, Filepath: ${v.filepath}`);
  }

  const activePlaylist = await prisma.playlist.findFirst({
    where: { isActive: true },
    include: {
      playlistVideos: {
        orderBy: { position: 'asc' },
        include: { video: true }
      }
    }
  });

  if (!activePlaylist) {
    console.log("\nNO ACTIVE PLAYLIST FOUND!");
  } else {
    console.log(`\nACTIVE PLAYLIST: ${activePlaylist.name} (Mode: ${activePlaylist.mode})`);
    console.log("VIDEOS IN ACTIVE PLAYLIST:");
    for (const pv of activePlaylist.playlistVideos) {
      console.log(`- Position: ${pv.position}, Video ID: ${pv.videoId}, Name: ${pv.video.name}, Status: ${pv.video.status}`);
    }
  }

  const settings = await prisma.streamSettings.findUnique({
    where: { id: 'singleton' }
  });
  console.log(`\nSTREAM SETTINGS:`);
  console.log(`- IsActive: ${settings?.isActive}`);
  console.log(`- CurrentVideoId: ${settings?.currentVideoId}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
